import { eventBus } from './core/event-bus';
import { danmakuState } from './core/state.svelte';
import { logger } from './core/logger';
import { SELECTORS } from './core/config';
import { Storage, episodeScope } from './core/storage';
import { hideMatchTitle, showMatchTitle } from './ui/match-title';
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
import type { EngineConfig, ProcessedComment, RawComment } from './types/index';

export type LoadReason = 'init' | 'search' | 'refresh' | 'settings-changed';

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
        init: (config: EngineConfig, comments: RawComment[]) => void;
        emit: (comment: ProcessedComment) => void;
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
    private rawComments: RawComment[] = [];

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
            eventBus.on('danmaku:visibility', ({ visible }) => {
                if (visible) this.hooks.engine.show();
                else this.hooks.engine.hide();
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
        hideMatchTitle();
        this.hooks.engine.destroy();
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
            if (reason === 'settings-changed') {
                await Storage.setEpisodeOffset(seasonId, episodeIndex, danmakuState.curEpOffset);
            }
            danmakuState.curEpOffset = await Storage.getEpisodeOffset(seasonId, episodeIndex);

            // ede.js 的本地 XML 路径不依赖 DanDanPlay 匹配：
            // 先用 Jellyfin ItemId 直接取本地弹幕，只有无数据/失败才回退在线匹配。
            if (danmakuState.useXmlDanmaku && reason !== 'search') {
                try {
                    const localComments = await this.hooks.getLocalComments(item.Id, { signal });
                    if (this.destroyed || signal.aborted) return;

                    if (localComments.length > 0) {
                        this.rawComments = localComments;
                        this.lastEpisodeId = null;
                        danmakuState.episodeInfo = null;
                        hideMatchTitle();

                        let inited = this.initEngine(localComments);
                        for (let i = 0; !inited && i < 10; i++) {
                            await this.hooks.waitMs(200);
                            if (this.destroyed || signal.aborted) return;
                            inited = this.initEngine(localComments);
                        }

                        if (inited) {
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
                return;
            }
            showMatchTitle(episode);

            if (episode.episodeId === this.lastEpisodeId && reason !== 'search' && reason !== 'settings-changed') {
                return;
            }

            const fetched = await this.hooks.fetcher.fetch(episode.episodeId, item.Id, { signal });
            if (this.destroyed || signal.aborted) return;

            this.rawComments = fetched;
            danmakuState.episodeInfo = episode;

            let inited = this.initEngine(fetched);
            for (let i = 0; !inited && i < 10; i++) {
                await this.hooks.waitMs(200);
                if (this.destroyed || signal.aborted) return;
                inited = this.initEngine(fetched);
            }
            if (inited) {
                this.lastEpisodeId = episode.episodeId;
            }
            eventBus.emit('danmaku:loaded', { count: fetched.length, source: 'online' });
        } catch (error) {
            if (this.isCancelled(error, signal)) return;
            logger.error('runtime', 'Failed to load danmaku', error);
            eventBus.emit('danmaku:error', { error: error as Error, source: 'load' });
        } finally {
            if (this.controller === controller) {
                danmakuState.loading = false;
            }
        }
    }

    async addSource(url: string): Promise<void> {
        if (this.destroyed) return;
        if (this.lastEpisodeId == null) {
            logger.warn('runtime', 'No episode loaded');
            return;
        }

        const episodeId = this.lastEpisodeId;

        try {
            const ext = await this.hooks.getExtComments(danmakuState.effectiveApiPrefix, url, { chConvert: danmakuState.chConvert });
            if (this.destroyed || this.lastEpisodeId !== episodeId) return;
            this.rawComments = [...this.rawComments, ...ext.map(convertDanDanPlayComment)];
            this.initEngine(this.rawComments);

            if (this.hooks.auth.isLoggedIn) {
                try {
                    await this.hooks.postRelatedSource(
                        danmakuState.effectiveApiPrefix,
                        this.lastEpisodeId,
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

        const time = media.video.currentTime;
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
            this.rawComments.push(raw);
            this.hooks.engine.emit(
                formatComment(raw, {
                    fontSize: danmakuState.fontSize,
                    fontFamily: danmakuState.fontFamily,
                    fontOptions: danmakuState.fontOptions,
                    timeOffset: 0,
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

    private clearPlayback(): void {
        hideMatchTitle();
        this.hooks.engine.destroy();
        this.lastEpisodeId = null;
        this.rawComments = [];
        danmakuState.episodeInfo = null;
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
        this.hooks.engine.init(
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
        return true;
    }

    private isCancelled(error: unknown, signal: AbortSignal): boolean {
        if (signal.aborted || this.destroyed) return true;
        if (error instanceof DanmakuError && error.code === ErrorCode.Cancelled) return true;
        return error instanceof Error && error.name === 'AbortError';
    }
}
