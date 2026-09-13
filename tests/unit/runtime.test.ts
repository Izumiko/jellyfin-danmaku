import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DanmakuRuntime } from '@/runtime';
import { eventBus } from '@/core/event-bus';
import { danmakuState } from '@/core/state.svelte';
import type { DanmakuRuntimeHooks } from '@/runtime';
import type { RawComment } from '@/types/index';

const item = { Id: 'i1', Name: 'N', SeasonId: 's', IndexNumber: 1 };
const episode = { episodeId: 42, animeTitle: 'A', episodeTitle: 'E1' };
const comments: RawComment[] = [{ time: 1, modeId: 1, color: 16777215, text: 'hi' }];

function createHooks(overrides: Partial<DanmakuRuntimeHooks> = {}) {
    const video = document.createElement('video');
    const container = document.createElement('div');
    const hooks: DanmakuRuntimeHooks = {
        matcher: { match: vi.fn().mockResolvedValue(episode) },
        fetcher: { fetch: vi.fn().mockResolvedValue(comments) },
        auth: {
            isLoggedIn: false,
            token: '',
            userName: '',
            login: vi.fn().mockResolvedValue(true),
            logout: vi.fn(),
            refreshIfNeeded: vi.fn().mockResolvedValue(undefined),
        },
        engine: { init: vi.fn(), destroy: vi.fn() },
        getCurrentItem: vi.fn().mockResolvedValue(item),
        getMedia: vi.fn().mockReturnValue({ video, container }),
        waitMs: vi.fn().mockResolvedValue(undefined),
        getExtComments: vi.fn(),
        postRelatedSource: vi.fn(),
        ...overrides,
    };
    return { hooks, video, container };
}

describe('DanmakuRuntime', () => {
    let runtime: DanmakuRuntime;
    let hooks: DanmakuRuntimeHooks;

    beforeEach(() => {
        eventBus.clear();
        danmakuState.isNewJellyfin = false;
        danmakuState.itemId = '';
        danmakuState.loading = false;
        danmakuState.episodeInfo = null;
        ({ hooks } = createHooks());
        runtime = new DanmakuRuntime(hooks);
    });

    afterEach(() => {
        runtime.destroy();
        eventBus.clear();
    });

    it('start matches auto then fetches and inits engine', async () => {
        await runtime.start();

        expect(hooks.matcher.match).toHaveBeenCalledWith(item, 'auto');
        expect(hooks.fetcher.fetch).toHaveBeenCalledWith(42, 'i1', expect.objectContaining({ signal: expect.any(AbortSignal) }));
        expect(hooks.engine.init).toHaveBeenCalledWith(
            expect.objectContaining({
                media: hooks.getMedia().video,
                container: hooks.getMedia().container,
                comments: [],
            }),
            comments,
        );
    });

    it('second load refresh with same episodeId does not fetch again', async () => {
        await runtime.start();
        vi.mocked(hooks.fetcher.fetch).mockClear();

        await runtime.load('refresh');

        expect(hooks.fetcher.fetch).not.toHaveBeenCalled();
    });

    it('retries fetch on refresh after first fetch rejects', async () => {
        vi.mocked(hooks.fetcher.fetch).mockRejectedValueOnce(new Error('Network error'));

        await runtime.start();
        expect(hooks.engine.init).not.toHaveBeenCalled();
        expect(hooks.fetcher.fetch).toHaveBeenCalledTimes(1);

        vi.mocked(hooks.fetcher.fetch).mockResolvedValue(comments);
        await runtime.load('refresh');

        expect(hooks.fetcher.fetch).toHaveBeenCalledTimes(2);
        expect(hooks.engine.init).toHaveBeenCalled();
    });

    it('load search uses manual and fetches even if same id', async () => {
        await runtime.start();
        vi.mocked(hooks.fetcher.fetch).mockClear();
        vi.mocked(hooks.matcher.match).mockClear();

        await runtime.load('search');

        expect(hooks.matcher.match).toHaveBeenCalledWith(item, 'manual');
        expect(hooks.fetcher.fetch).toHaveBeenCalled();
    });

    it('addSource merges comments and posts related when logged in', async () => {
        hooks.auth.isLoggedIn = true;
        hooks.auth.token = 'tok';
        vi.mocked(hooks.getExtComments!).mockResolvedValue([{ cid: 2, p: '2,1,16777215,u', m: 'ext' }]);
        vi.mocked(hooks.postRelatedSource!).mockResolvedValue(undefined);

        await runtime.start();
        vi.mocked(hooks.engine.init).mockClear();

        await runtime.addSource('https://example.com/xml');

        expect(hooks.getExtComments).toHaveBeenCalledWith(danmakuState.effectiveApiPrefix, 'https://example.com/xml', {
            chConvert: danmakuState.chConvert,
        });
        expect(hooks.engine.init).toHaveBeenCalledWith(
            expect.anything(),
            expect.arrayContaining([
                comments[0],
                expect.objectContaining({ time: 2, modeId: 1, color: 16777215, text: 'ext' }),
            ]),
        );
        expect(hooks.postRelatedSource).toHaveBeenCalledWith(danmakuState.effectiveApiPrefix, 42, 'https://example.com/xml', 'tok');
    });

    it('destroy then eventBus reload does not fetch', async () => {
        await runtime.start();
        vi.mocked(hooks.fetcher.fetch).mockClear();

        runtime.destroy();
        eventBus.emit('danmaku:reload', { reason: 'refresh' });
        await Promise.resolve();

        expect(hooks.fetcher.fetch).not.toHaveBeenCalled();
    });

    it('aborts in-flight fetch on destroy', async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        vi.mocked(hooks.fetcher.fetch).mockImplementation(async (_episodeId, _itemId, options) => {
            await gate;
            if (options?.signal?.aborted) {
                const err = new Error('aborted');
                err.name = 'AbortError';
                throw err;
            }
            return comments;
        });

        const started = runtime.start();
        await vi.waitFor(() => expect(hooks.fetcher.fetch).toHaveBeenCalled());

        runtime.destroy();
        const signal = vi.mocked(hooks.fetcher.fetch).mock.calls[0][2]?.signal;
        expect(signal?.aborted).toBe(true);

        release();
        await started;

        expect(hooks.engine.init).not.toHaveBeenCalled();
    });

    it('load refresh inits engine when media was missing on start', async () => {
        const video = document.createElement('video');
        const container = document.createElement('div');
        vi.mocked(hooks.getMedia).mockReturnValue({ video: null, container: null });

        await runtime.start();
        expect(hooks.engine.init).not.toHaveBeenCalled();

        vi.mocked(hooks.getMedia).mockReturnValue({ video, container });
        await runtime.load('refresh');

        expect(hooks.engine.init).toHaveBeenCalled();
    });

    it('addSource does not merge comments after episode switch', async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        vi.mocked(hooks.getExtComments!).mockImplementation(async () => {
            await gate;
            return [{ cid: 2, p: '2,1,16777215,u', m: 'ext' }];
        });
        const episode99 = { episodeId: 99, animeTitle: 'B', episodeTitle: 'E2' };
        const comments99: RawComment[] = [{ time: 2, modeId: 1, color: 16777215, text: 'ep99' }];
        vi.mocked(hooks.matcher.match).mockResolvedValueOnce(episode).mockResolvedValueOnce(episode99);
        vi.mocked(hooks.fetcher.fetch).mockResolvedValueOnce(comments).mockResolvedValueOnce(comments99);

        await runtime.start();
        vi.mocked(hooks.engine.init).mockClear();

        const adding = runtime.addSource('https://example.com/xml');
        await vi.waitFor(() => expect(hooks.getExtComments).toHaveBeenCalled());

        await runtime.load('refresh');
        release();
        await adding;

        expect(hooks.engine.init).not.toHaveBeenCalledWith(
            expect.anything(),
            expect.arrayContaining([expect.objectContaining({ text: 'ext' })]),
        );
    });

    it('destroy during addSource does not init engine', async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        vi.mocked(hooks.getExtComments!).mockImplementation(async () => {
            await gate;
            return [{ cid: 2, p: '2,1,16777215,u', m: 'ext' }];
        });

        await runtime.start();
        vi.mocked(hooks.engine.init).mockClear();

        const adding = runtime.addSource('https://example.com/xml');
        await vi.waitFor(() => expect(hooks.getExtComments).toHaveBeenCalled());

        runtime.destroy();
        release();
        await adding;

        expect(hooks.engine.init).not.toHaveBeenCalled();
    });
});
