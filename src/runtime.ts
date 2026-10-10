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
import { formatComment } from './danmaku/processor';
import { showInputDialog, showSelectDialog } from './ui/dialogs';
import { DanmakuError, ErrorCode } from './types/index';
import type { DanmakuConfig, EngineConfig, ProcessedComment, RawComment } from './types/index';

export type LoadReason = 'init' | 'search' | 'refresh' | 'settings-changed';

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
];
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
            this.refetchTimer = setTimeout(() => void this.load('settings-changed'), REFETCH_DELAY_MS);
        } else if (keys.some((key) => REPROCESS_KEYS.includes(key)) && this.engineReady) {
            clearTimeout(this.reprocessTimer);
            this.reprocessTimer = setTimeout(() => {
                if (!this.destroyed && this.engineReady) this.initEngine(this.rawComments);
            }, REPROCESS_DELAY_MS);
        }
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
        try {
            if (reason === 'settings-changed') {
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

            // ede.js 的本地 XML 路径不依赖 DanDanPlay 匹配：
            // 先用 Jellyfin ItemId 直接取本地弹幕，只有无数据/失败才回退在线匹配。
            if (danmakuState.useXmlDanmaku && reason !== 'search') {
                // 转码播放时 seek 也会改写 video.src；同一条目的本地弹幕无需重复下载重建。
                if (reason === 'refresh' && this.lastLocalItemId === item.Id) return;
                try {
                    const localComments = await this.hooks.getLocalComments(item.Id, { signal });
                    if (this.destroyed || signal.aborted) return;

                    if (localComments.length > 0) {
                        this.rawComments = localComments;
                        this.lastEpisodeId = null;
                        danmakuState.episodeInfo = null;

                        let inited = this.initEngine(localComments);
                        for (let i = 0; !inited && i < 10; i++) {
                            await this.hooks.waitMs(200);
                            if (this.destroyed || signal.aborted) return;
                            inited = this.initEngine(localComments);
                        }

                        if (inited) {
                            this.lastLocalItemId = item.Id;
                            danmakuState.loadedSource = 'local';
                            danmakuState.loadedCount = localComments.length;
                            this.toast(`已加载本地弹幕 · ${localComments.length} 条`);
                            eventBus.emit('danmaku:loaded', {
                                count: localComments.length,
                                source: 'local',
                            });
                        }
                        return;
                    }

                    logger.info('runtime', 'Local XML returned no comments; falling back to online');
                } catch (error) {
                    if (this.isCancelled(error, signal)) return;
                    logger.warn('runtime', 'Local XML unavailable; falling back to online', error);
                }
            }

            const episode = await this.hooks.matcher.match(item, reason === 'search' ? 'manual' : 'auto');
            if (this.destroyed || signal.aborted) return;
            if (!episode) {
                logger.warn('runtime', 'No episode matched; keeping current danmaku');
                if (reason === 'init' || reason === 'search') {
                    this.toast(reason === 'search' ? '未选择或未找到匹配的剧集' : '未匹配到弹幕，可在弹幕设置中手动搜索');
                }
                return;
            }

            if (episode.episodeId === this.lastEpisodeId && reason !== 'search' && reason !== 'settings-changed') {
                return;
            }

            const fetched = await this.hooks.fetcher.fetch(episode.episodeId, item.Id, { signal });
            if (this.destroyed || signal.aborted) return;

            this.rawComments = fetched;
            this.lastLocalItemId = null;
            danmakuState.episodeInfo = episode;

            let inited = this.initEngine(fetched);
            for (let i = 0; !inited && i < 10; i++) {
                await this.hooks.waitMs(200);
                if (this.destroyed || signal.aborted) return;
                inited = this.initEngine(fetched);
            }
            if (inited) {
                this.lastEpisodeId = episode.episodeId;
                danmakuState.loadedSource = 'online';
                danmakuState.loadedCount = fetched.length;
                this.toast(`${episode.animeTitle} - ${episode.episodeTitle} · ${fetched.length} 条弹幕`);
            }
            eventBus.emit('danmaku:loaded', { count: fetched.length, source: 'online' });
        } catch (error) {
            if (this.isCancelled(error, signal)) return;
            logger.error('runtime', 'Failed to load danmaku', error);
            this.toast('弹幕加载失败，请检查网络或 API 设置', 'error');
            eventBus.emit('danmaku:error', { error: error as Error, source: 'load' });
        } finally {
            if (this.controller === controller) {
                danmakuState.loading = false;
            }
        }
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
