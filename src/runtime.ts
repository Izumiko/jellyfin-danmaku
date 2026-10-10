import { eventBus } from './core/event-bus';
import { danmakuState } from './core/state.svelte';
import { logger } from './core/logger';
import { SELECTORS } from './core/config';
import { Storage, episodeScope } from './core/storage';
import { EpisodeMatcher } from './services/episode-matcher';
import { CommentFetcher } from './services/comment-fetcher';
import { DanDanPlayAuth } from './services/dandanplay/auth';
import { getExtComments, convertDanDanPlayComment, postComment, postRelatedSource } from './services/dandanplay/client';
import { getCurrentItem, getSeriesOriginalTitle } from './services/jellyfin/client';
import { getLocalXmlDanmaku } from './services/jellyfin/danmaku';
import { danmakuEngine } from './danmaku/engine';
import { formatComment, sourceStats } from './danmaku/processor';
import { BLOCK_KEYS } from './core/config';
import { showInputDialog, showSelectDialog } from './ui/dialogs';
import { DanmakuError, ErrorCode } from './types/index';
import type { DanmakuConfig, EngineConfig, ProcessedComment, RawComment } from './types/index';

/** reload：用户主动「重新加载」，与 settings-changed 一样强制重新拉取 */
export type LoadReason = 'init' | 'search' | 'refresh' | 'reload' | 'settings-changed';

/** 需要重新请求网络的设置 */
const REFETCH_KEYS: readonly (keyof DanmakuConfig)[] = ['chConvert', 'customCorsProxy', 'customApiPrefix', 'useXmlDanmaku'];
/** 只需用已缓存的原始弹幕重新处理、重建引擎的设置 */
const REPROCESS_KEYS: readonly (keyof DanmakuConfig)[] = [
    'fontSize',
    'fontFamily',
    'fontOptions',
    'speed',
    'heightRatio',
    'sourceFilter',
    'modeFilter',
    'densityLimit',
    'useAntiOverlap',
    'curEpOffset',
    ...BLOCK_KEYS,
];
const WATCHDOG_INTERVAL_MS = 2000;
const WATCHDOG_MAX_REMOUNTS = 3;
const REPROCESS_DELAY_MS = 200;
const REFETCH_DELAY_MS = 600;

export type RuntimeMedia = {
    video: HTMLVideoElement | null;
    container: HTMLElement | null;
};

export type DanmakuRuntimeHooks = {
    matcher: { match: EpisodeMatcher['match'] };
    fetcher: { fetch: CommentFetcher['fetch'] };
    auth: {
        isLoggedIn: boolean;
        token: string;
        userName: string;
        login: (account: string, password: string) => Promise<boolean>;
        logout: () => void;
        refreshIfNeeded: () => Promise<void>;
        setApiPrefix?: (apiPrefix: string) => void;
    };
    engine: {
        init: (config: EngineConfig, comments: RawComment[]) => number | void;
        emit: (comment: ProcessedComment) => void;
        setOpacity?: (opacity: number) => void;
        isMounted?: () => boolean;
        show: () => void;
        hide: () => void;
        destroy: () => void;
    };
    getCurrentItem: typeof getCurrentItem;
    getMedia: () => RuntimeMedia;
    waitMs: (ms: number) => Promise<void>;
    getExtComments?: typeof getExtComments;
    postRelatedSource?: typeof postRelatedSource;
    postComment?: typeof postComment;
    getLocalComments?: typeof getLocalXmlDanmaku;
};

/** 把 HTTP/API 错误转成面向用户的一句话，优先使用接口返回的 errorMessage */
export function describeLoadError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const http = message.match(/^HTTP (\d+): ([\s\S]*)$/);
    if (http) {
        try {
            const body = JSON.parse(http[2]) as { errorMessage?: string; message?: string };
            const detail = body.errorMessage || body.message;
            if (detail) return `${detail}（HTTP ${http[1]}）`;
        } catch {
            // 非 JSON 响应体
        }
        return `服务器返回 HTTP ${http[1]}`;
    }
    if (error instanceof DanmakuError && error.code === ErrorCode.Timeout) return '请求超时';
    if (error instanceof DanmakuError && error.code === ErrorCode.Network) return '网络错误，无法连接弹幕服务器';
    return message;
}

function defaultGetMedia(): RuntimeMedia {
    return {
        video: document.querySelector('video'),
        container: document.querySelector(SELECTORS.mediaContainer) as HTMLElement | null,
    };
}

function defaultWaitMs(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultMatcher(): DanmakuRuntimeHooks['matcher'] {
    return {
        match: (item, mode) =>
            new EpisodeMatcher({
                apiPrefix: danmakuState.effectiveApiPrefix,
                chConvert: danmakuState.chConvert,
                showInputDialog,
                showSelectDialog,
                getSeriesOriginalTitle,
            }).match(item, mode),
    };
}

function defaultFetcher(): DanmakuRuntimeHooks['fetcher'] {
    return {
        fetch: (episodeId, jellyfinItemId, options) =>
            new CommentFetcher({
                apiPrefix: danmakuState.effectiveApiPrefix,
                chConvert: danmakuState.chConvert,
                sourceFilter: danmakuState.sourceFilter,
                // Runtime 先按 ede.js 顺序尝试本地 XML；在线 fetcher 不再重复请求本地。
                useXmlDanmaku: false,
            }).fetch(episodeId, jellyfinItemId, options),
    };
}

export class DanmakuRuntime {
    private readonly hooks: Required<DanmakuRuntimeHooks>;
    private unsubscribers: (() => void)[] = [];
    private controller: AbortController | null = null;
    private destroyed = false;
    private lastEpisodeId: number | null = null;
    private lastLocalItemId: string | null = null;
    private rawComments: RawComment[] = [];
    private engineReady = false;
    private currentScope: { seasonId: string; episodeIndex: number } | null = null;
    private reprocessTimer: ReturnType<typeof setTimeout> | undefined;
    private refetchTimer: ReturnType<typeof setTimeout> | undefined;
    private watchdogTimer: ReturnType<typeof setInterval> | undefined;
    private remounts = 0;
    /** rawComments 所属的 Jellyfin 条目 */
    private rawItemId: string | null = null;

    constructor(hooks: Partial<DanmakuRuntimeHooks> = {}) {
        this.hooks = {
            matcher: hooks.matcher ?? defaultMatcher(),
            fetcher: hooks.fetcher ?? defaultFetcher(),
            auth: hooks.auth ?? new DanDanPlayAuth(danmakuState.effectiveApiPrefix),
            engine: hooks.engine ?? danmakuEngine,
            getCurrentItem: hooks.getCurrentItem ?? getCurrentItem,
            getMedia: hooks.getMedia ?? defaultGetMedia,
            waitMs: hooks.waitMs ?? defaultWaitMs,
            getExtComments: hooks.getExtComments ?? getExtComments,
            postRelatedSource: hooks.postRelatedSource ?? postRelatedSource,
            postComment: hooks.postComment ?? postComment,
            getLocalComments: hooks.getLocalComments ?? getLocalXmlDanmaku,
        };
    }

    async start(): Promise<void> {
        this.unsubscribers.push(
            eventBus.on('danmaku:reload', (data) => {
                void this.load(data.reason);
            }),
            eventBus.on('settings:changed', ({ keys }) => {
                this.applySettings(keys);
            }),
            eventBus.on('danmaku:add-source', (data) => {
                void this.addSource(data.url);
            }),
            eventBus.on('danmaku:send', (data) => {
                void this.sendDanmaku(data.text, data.mode, data.color);
            }),
            eventBus.on('auth:login', (data) => {
                void this.login(data.account, data.password);
            }),
            eventBus.on('auth:logout', () => {
                this.logout();
            }),
            eventBus.on('media:source-changed', async () => {
                await this.hooks.waitMs(2000);
                await this.load('refresh');
            }),
        );

        try {
            await Storage.migrateEpisodeCacheFromLocalStorage();
            await Storage.sweepExpiredEpisodeCache();
        } catch (error) {
            logger.warn('runtime', 'Episode cache migrate/sweep failed', error);
        }

        this.syncAuthApiPrefix();
        await this.hooks.auth.refreshIfNeeded();
        this.syncAuthState();
        await this.load('init');
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.controller?.abort();
        this.unsubscribers.forEach((unsub) => unsub());
        this.unsubscribers = [];
        clearTimeout(this.reprocessTimer);
        clearTimeout(this.refetchTimer);
        clearInterval(this.watchdogTimer);
        this.engineReady = false;
        this.hooks.engine.destroy();
    }

    /**
     * 设置即时生效，按影响范围分级处理：
     * - 开关/透明度：直接作用于引擎
     * - 样式/过滤/偏移：用已缓存的原始弹幕重建（不走网络）
     * - 简繁/API/本地 XML：重新加载
     */
    private applySettings(keys: (keyof DanmakuConfig)[]): void {
        if (this.destroyed) return;

        if (keys.includes('danmakuSwitch')) {
            if (danmakuState.danmakuSwitch) this.hooks.engine.show();
            else this.hooks.engine.hide();
        }
        if (keys.includes('opacity')) {
            this.hooks.engine.setOpacity?.(danmakuState.opacity);
        }
        if (keys.includes('curEpOffset') && this.currentScope) {
            const { seasonId, episodeIndex } = this.currentScope;
            void Storage.setEpisodeOffset(seasonId, episodeIndex, danmakuState.curEpOffset);
        }

        if (keys.some((key) => REFETCH_KEYS.includes(key))) {
            clearTimeout(this.reprocessTimer);
            clearTimeout(this.refetchTimer);
            const apiChanged = keys.includes('customApiPrefix');
            this.refetchTimer = setTimeout(async () => {
                // 换了弹幕 API：旧的匹配记忆指向另一个服务端的 id（上游 issue #91）
                if (apiChanged) {
                    await Storage.clearEpisodeMappings();
                    this.lastEpisodeId = null;
                }
                void this.load('settings-changed');
            }, REFETCH_DELAY_MS);
        } else if (keys.some((key) => REPROCESS_KEYS.includes(key)) && this.engineReady) {
            clearTimeout(this.reprocessTimer);
            this.reprocessTimer = setTimeout(() => {
                if (!this.destroyed && this.engineReady && this.rawCommentsAreCurrent()) this.initEngine(this.rawComments);
            }, REPROCESS_DELAY_MS);
        }
    }

    /** 已切到新条目、新弹幕还没加载完时，不能拿上一集的弹幕重渲染 */
    private rawCommentsAreCurrent(): boolean {
        const current = danmakuState.itemId;
        return !current || !this.rawItemId || this.rawItemId.replace(/-/g, '').toLowerCase() === current;
    }

    private toast(message: string, tone: 'info' | 'error' = 'info'): void {
        eventBus.emit('ui:toast', { message, tone });
    }

    async load(reason: LoadReason): Promise<void> {
        if (this.destroyed) return;

        this.controller?.abort();
        const controller = new AbortController();
        this.controller = controller;
        const { signal } = controller;

        danmakuState.loading = true;
        danmakuState.loadError = null;
        try {
            if (reason === 'settings-changed' || reason === 'reload') {
                this.syncAuthApiPrefix();
            }
            if (danmakuState.isNewJellyfin && !danmakuState.itemId) {
                for (let i = 0; i < 10 && !danmakuState.itemId; i++) {
                    await this.hooks.waitMs(200);
                    if (this.destroyed || signal.aborted) return;
                }
            }

            let item = await this.hooks.getCurrentItem(danmakuState.isNewJellyfin, danmakuState.itemId);
            for (let i = 0; !item && i < 15; i++) {
                await this.hooks.waitMs(200);
                if (this.destroyed || signal.aborted) return;
                item = await this.hooks.getCurrentItem(danmakuState.isNewJellyfin, danmakuState.itemId);
            }
            if (this.destroyed || signal.aborted) return;
            if (!item) {
                logger.warn('runtime', 'No current item; keeping current danmaku until a valid item is available');
                return;
            }

            const { seasonId, episodeIndex } = episodeScope(item);
            this.currentScope = { seasonId, episodeIndex };
            danmakuState.curEpOffset = await Storage.getEpisodeOffset(seasonId, episodeIndex);

            danmakuState.currentTitle = item.SeriesName || item.Name || '';

            // ede.js 的本地 XML 路径不依赖 DanDanPlay 匹配：
            // 先用 Jellyfin ItemId 直接取本地弹幕，只有无数据/失败才回退在线匹配。
            if (danmakuState.useXmlDanmaku && reason !== 'search') {
                // 转码播放时 seek 也会改写 video.src；同一条目的本地弹幕无需重复下载重建。
                if (reason === 'refresh' && this.lastLocalItemId === item.Id) return;
                const local = await this.tryLoadLocal(item.Id, signal);
                if (local !== 'empty') return;
                logger.info('runtime', 'Local XML unavailable or empty; falling back to online');
            }

            const episode = await this.hooks.matcher.match(item, reason === 'search' ? 'manual' : 'auto');
            if (this.destroyed || signal.aborted) return;
            if (!episode) {
                logger.warn('runtime', 'No episode matched; keeping current danmaku');
                // 在线匹配失败时改用 Jellyfin 弹幕插件的弹幕兜底（手动搜索取消/无结果时不回退）
                if (danmakuState.xmlFallback && !danmakuState.useXmlDanmaku && reason !== 'search') {
                    const local = await this.tryLoadLocal(item.Id, signal);
                    if (local !== 'empty') return;
                }
                if (reason === 'init') this.toast('未匹配到弹幕，可在弹幕设置中手动搜索');
                return;
            }

            if (episode.episodeId === this.lastEpisodeId && (reason === 'init' || reason === 'refresh')) {
                return;
            }

            const fetched = await this.hooks.fetcher.fetch(episode.episodeId, item.Id, { signal });
            if (this.destroyed || signal.aborted) return;

            this.lastLocalItemId = null;
            danmakuState.episodeInfo = episode;
            const inited = await this.showComments(fetched, item.Id, 'online', signal);
            if (inited === null) return;
            if (inited) {
                this.lastEpisodeId = episode.episodeId;
                this.toast(`${episode.animeTitle} - ${episode.episodeTitle} · ${fetched.length} 条弹幕`);
            }
            eventBus.emit('danmaku:loaded', { count: fetched.length, source: 'online' });
        } catch (error) {
            if (this.isCancelled(error, signal)) return;
            logger.error('runtime', 'Failed to load danmaku', error);
            danmakuState.loadError = describeLoadError(error);
            this.toast(`弹幕加载失败：${danmakuState.loadError}`, 'error');
            eventBus.emit('danmaku:error', { error: error as Error, source: 'load' });
        } finally {
            if (this.controller === controller) {
                danmakuState.loading = false;
            }
        }
    }

    /**
     * 读取 Jellyfin 弹幕插件提供的本地 XML 弹幕并显示。
     * @returns loaded 已显示；empty 没有数据或接口不可用；aborted 已取消
     */
    private async tryLoadLocal(jellyfinItemId: string, signal: AbortSignal): Promise<'loaded' | 'empty' | 'aborted'> {
        try {
            const comments = await this.hooks.getLocalComments(jellyfinItemId, { signal });
            if (this.destroyed || signal.aborted) return 'aborted';
            if (comments.length === 0) return 'empty';

            this.lastEpisodeId = null;
            danmakuState.episodeInfo = null;
            const inited = await this.showComments(comments, jellyfinItemId, 'local', signal);
            if (inited === null) return 'aborted';
            if (inited) {
                this.lastLocalItemId = jellyfinItemId;
                this.toast(`已加载本地弹幕 · ${comments.length} 条`);
                eventBus.emit('danmaku:loaded', { count: comments.length, source: 'local' });
            }
            return 'loaded';
        } catch (error) {
            if (this.isCancelled(error, signal)) return 'aborted';
            logger.warn('runtime', 'Local XML unavailable', error);
            return 'empty';
        }
    }

    /**
     * 记录原始弹幕并初始化引擎；播放器容器可能稍晚出现，最多等待 2 秒。
     * @returns true 已显示；false 容器始终未出现；null 已取消
     */
    private async showComments(comments: RawComment[], jellyfinItemId: string, source: 'online' | 'local', signal: AbortSignal): Promise<boolean | null> {
        this.rawComments = comments;
        this.rawItemId = jellyfinItemId;

        let inited = this.initEngine(comments);
        for (let i = 0; !inited && i < 10; i++) {
            await this.hooks.waitMs(200);
            if (this.destroyed || signal.aborted) return null;
            inited = this.initEngine(comments);
        }
        if (inited) {
            danmakuState.loadedSource = source;
            danmakuState.loadedCount = comments.length;
            danmakuState.sourceStats = sourceStats(comments);
            this.startWatchdog();
        }
        return inited;
    }

    /** React 重渲染可能把弹幕容器从 #reactRoot 摘掉：发现后用缓存的弹幕重建（每次加载最多 3 次） */
    private startWatchdog(): void {
        clearInterval(this.watchdogTimer);
        this.remounts = 0;
        if (!this.hooks.engine.isMounted) return;
        this.watchdogTimer = setInterval(() => {
            if (this.destroyed || !this.engineReady || this.hooks.engine.isMounted?.() !== false) return;
            if (this.remounts >= WATCHDOG_MAX_REMOUNTS || !this.rawCommentsAreCurrent()) {
                clearInterval(this.watchdogTimer);
                return;
            }
            this.remounts++;
            logger.warn('runtime', `Danmaku container detached, remounting (${this.remounts}/${WATCHDOG_MAX_REMOUNTS})`);
            this.initEngine(this.rawComments);
        }, WATCHDOG_INTERVAL_MS);
    }

    async addSource(url: string): Promise<void> {
        if (this.destroyed) return;

        // 与 ede.js 一致：无论是否已匹配（如正在使用本地 XML）都可以追加弹幕源；
        // 只有提交关联源给弹弹Play 才需要 episodeId。
        const episodeId = this.lastEpisodeId;
        const localItemId = this.lastLocalItemId;

        try {
            const ext = await this.hooks.getExtComments(danmakuState.effectiveApiPrefix, url, { chConvert: danmakuState.chConvert });
            if (this.destroyed || this.lastEpisodeId !== episodeId || this.lastLocalItemId !== localItemId) return;
            this.rawComments = [...this.rawComments, ...ext.map(convertDanDanPlayComment)];
            this.initEngine(this.rawComments);
            danmakuState.loadedCount = this.rawComments.length;
            danmakuState.sourceStats = sourceStats(this.rawComments);
            logger.info('runtime', `Added ${ext.length} comments from source`);
            this.toast(`已增加 ${ext.length} 条弹幕`);

            if (episodeId != null && this.hooks.auth.isLoggedIn) {
                try {
                    await this.hooks.postRelatedSource(
                        danmakuState.effectiveApiPrefix,
                        episodeId,
                        url,
                        this.hooks.auth.token,
                    );
                } catch (error) {
                    // 本地追加已经成功，related 提交失败不应把整个“增加弹幕源”视为失败。
                    logger.warn('runtime', 'Source loaded, but failed to post related source', error);
                }
            }
        } catch (error) {
            logger.error('runtime', 'Failed to add source', error);
            this.toast('增加弹幕源失败', 'error');
        }
    }

    private async login(account: string, password: string): Promise<void> {
        this.syncAuthApiPrefix();
        const success = await this.hooks.auth.login(account, password);
        this.syncAuthState();
        eventBus.emit('auth:login-result', { success });
    }

    private async sendDanmaku(text: string, mode: 1 | 4 | 5 | 6, color: number): Promise<void> {
        const message = text.trim();
        if (!message) {
            eventBus.emit('danmaku:send-result', { success: false, message: '弹幕内容不能为空' });
            return;
        }
        if (!this.hooks.auth.isLoggedIn) {
            eventBus.emit('danmaku:send-result', { success: false, message: '请先登录弹弹Play' });
            return;
        }
        if (this.lastEpisodeId == null || !danmakuState.episodeInfo) {
            eventBus.emit('danmaku:send-result', { success: false, message: '请先完成弹幕匹配' });
            return;
        }

        const media = this.hooks.getMedia();
        if (!media.video) {
            eventBus.emit('danmaku:send-result', { success: false, message: '未找到播放器' });
            return;
        }

        // 屏幕上的弹幕时间 = 服务端时间 + 当前集偏移，因此提交时要换算回服务端时间轴，
        // 否则设置了偏移后，自己发的弹幕在其他客户端会错位。
        const displayTime = media.video.currentTime;
        const offset = danmakuState.curEpOffset || 0;
        const time = Math.max(0, displayTime - offset);
        try {
            await this.hooks.postComment(
                danmakuState.effectiveApiPrefix,
                this.lastEpisodeId,
                { text: message, time, mode, color },
                this.hooks.auth.token,
            );

            const raw: RawComment = {
                time,
                modeId: mode,
                color,
                text: message,
                user: this.hooks.auth.userName || undefined,
            };
            this.rawComments = [...this.rawComments, raw];
            danmakuState.loadedCount = this.rawComments.length;
            this.hooks.engine.emit(
                formatComment(raw, {
                    fontSize: danmakuState.fontSize,
                    fontFamily: danmakuState.fontFamily,
                    fontOptions: danmakuState.fontOptions,
                    timeOffset: offset,
                }),
            );

            logger.info('runtime', 'Danmaku posted successfully');
            eventBus.emit('danmaku:send-result', { success: true });
        } catch (error) {
            logger.error('runtime', 'Failed to post danmaku', error);
            eventBus.emit('danmaku:send-result', {
                success: false,
                message: error instanceof Error ? error.message : '发送弹幕失败',
            });
        }
    }

    private logout(): void {
        this.hooks.auth.logout();
        this.syncAuthState();
    }

    private syncAuthApiPrefix(): void {
        this.hooks.auth.setApiPrefix?.(danmakuState.effectiveApiPrefix);
    }

    private syncAuthState(): void {
        danmakuState.ddplayLoggedIn = this.hooks.auth.isLoggedIn;
        danmakuState.ddplayUserName = this.hooks.auth.userName;
    }

    private initEngine(comments: RawComment[]): boolean {
        const media = this.hooks.getMedia();
        if (!media.video || !media.container) return false;
        const visible = this.hooks.engine.init(
            {
                container: media.container,
                media: media.video,
                comments: [],
                speed: danmakuState.speed,
                opacity: danmakuState.opacity,
                heightRatio: danmakuState.heightRatio,
                visible: danmakuState.danmakuSwitch,
            },
            comments,
        );
        this.engineReady = true;
        danmakuState.visibleCount = typeof visible === 'number' ? visible : comments.length;
        return true;
    }

    private isCancelled(error: unknown, signal: AbortSignal): boolean {
        if (signal.aborted || this.destroyed) return true;
        if (error instanceof DanmakuError && error.code === ErrorCode.Cancelled) return true;
        return error instanceof Error && error.name === 'AbortError';
    }
}
