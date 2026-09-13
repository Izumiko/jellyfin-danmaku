import { eventBus } from './core/event-bus';
import { danmakuState } from './core/state.svelte';
import { logger } from './core/logger';
import { SELECTORS } from './core/config';
import { EpisodeMatcher } from './services/episode-matcher';
import { CommentFetcher } from './services/comment-fetcher';
import { DanDanPlayAuth } from './services/dandanplay/auth';
import { getExtComments, convertDanDanPlayComment, postRelatedSource } from './services/dandanplay/client';
import { getCurrentItem } from './services/jellyfin/client';
import { danmakuEngine } from './danmaku/engine';
import { showInputDialog, showSelectDialog } from './ui/dialogs';
import { DanmakuError, ErrorCode } from './types/index';
import type { EngineConfig, RawComment } from './types/index';

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
    };
    engine: { init: (config: EngineConfig, comments: RawComment[]) => void; destroy: () => void };
    getCurrentItem: typeof getCurrentItem;
    getMedia: () => RuntimeMedia;
    waitMs: (ms: number) => Promise<void>;
    getExtComments?: typeof getExtComments;
    postRelatedSource?: typeof postRelatedSource;
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
                useXmlDanmaku: danmakuState.useXmlDanmaku,
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
        };
    }

    async start(): Promise<void> {
        this.unsubscribers.push(
            eventBus.on('danmaku:reload', (data) => {
                void this.load(data.reason);
            }),
            eventBus.on('danmaku:add-source', (data) => {
                void this.addSource(data.url);
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
            if (danmakuState.isNewJellyfin && !danmakuState.itemId) {
                for (let i = 0; i < 10 && !danmakuState.itemId; i++) {
                    await this.hooks.waitMs(200);
                    if (this.destroyed || signal.aborted) return;
                }
            }

            const item = await this.hooks.getCurrentItem(danmakuState.isNewJellyfin, danmakuState.itemId);
            if (this.destroyed || signal.aborted) return;
            if (!item) {
                logger.warn('runtime', 'No current item');
                return;
            }

            const episode = await this.hooks.matcher.match(item, reason === 'search' ? 'manual' : 'auto');
            if (this.destroyed || signal.aborted) return;
            if (!episode) {
                logger.warn('runtime', 'No episode matched');
                return;
            }

            if (episode.episodeId === this.lastEpisodeId && reason !== 'search' && reason !== 'settings-changed') {
                return;
            }

            const fetched = await this.hooks.fetcher.fetch(episode.episodeId, item.Id, { signal });
            if (this.destroyed || signal.aborted) return;

            this.rawComments = fetched;
            this.lastEpisodeId = episode.episodeId;
            danmakuState.episodeInfo = episode;
            this.initEngine(fetched);
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
        if (this.lastEpisodeId == null) {
            logger.warn('runtime', 'No episode loaded');
            return;
        }

        const ext = await this.hooks.getExtComments(danmakuState.effectiveApiPrefix, url, { chConvert: danmakuState.chConvert });
        this.rawComments = [...this.rawComments, ...ext.map(convertDanDanPlayComment)];
        this.initEngine(this.rawComments);

        if (this.hooks.auth.isLoggedIn) {
            await this.hooks.postRelatedSource(danmakuState.effectiveApiPrefix, this.lastEpisodeId, url, this.hooks.auth.token);
        }
    }

    private async login(account: string, password: string): Promise<void> {
        await this.hooks.auth.login(account, password);
        this.syncAuthState();
    }

    private logout(): void {
        this.hooks.auth.logout();
        this.syncAuthState();
    }

    private syncAuthState(): void {
        danmakuState.ddplayLoggedIn = this.hooks.auth.isLoggedIn;
        danmakuState.ddplayUserName = this.hooks.auth.userName;
    }

    private initEngine(comments: RawComment[]): void {
        const media = this.hooks.getMedia();
        if (!media.video || !media.container) return;
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
    }

    private isCancelled(error: unknown, signal: AbortSignal): boolean {
        if (signal.aborted || this.destroyed) return true;
        if (error instanceof DanmakuError && error.code === ErrorCode.Cancelled) return true;
        return error instanceof Error && error.name === 'AbortError';
    }
}
