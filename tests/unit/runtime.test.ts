import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DanmakuRuntime, describeLoadError } from '@/runtime';
import { DanmakuError, ErrorCode } from '@/types/index';
import { eventBus } from '@/core/event-bus';
import { danmakuState } from '@/core/state.svelte';
import { Storage } from '@/core/storage';
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
        engine: {
            init: vi.fn(),
            emit: vi.fn(),
            show: vi.fn(),
            hide: vi.fn(),
            destroy: vi.fn(),
        },
        getCurrentItem: vi.fn().mockResolvedValue(item),
        getMedia: vi.fn().mockReturnValue({ video, container }),
        waitMs: vi.fn().mockResolvedValue(undefined),
        getExtComments: vi.fn(),
        postRelatedSource: vi.fn(),
        postComment: vi.fn().mockResolvedValue(undefined),
        getLocalComments: vi.fn().mockResolvedValue([]),
        ...overrides,
    };
    return { hooks, video, container };
}

describe('DanmakuRuntime', () => {
    let runtime: DanmakuRuntime;
    let hooks: DanmakuRuntimeHooks;

    beforeEach(() => {
        eventBus.clear();
        danmakuState.hydrate();
        danmakuState.isNewJellyfin = false;
        danmakuState.itemId = '';
        danmakuState.loading = false;
        danmakuState.episodeInfo = null;
        danmakuState.curEpOffset = 0;
        danmakuState.useXmlDanmaku = false;
        const header = document.createElement('div');
        header.className = 'skinHeader';
        document.body.appendChild(header);
        ({ hooks } = createHooks());
        runtime = new DanmakuRuntime(hooks);
    });

    afterEach(() => {
        runtime.destroy();
        eventBus.clear();
        document.body.innerHTML = '';
    });

    it('retries getCurrentItem when first lookup is empty', async () => {
        vi.mocked(hooks.getCurrentItem).mockResolvedValueOnce(null).mockResolvedValue(item);
        await runtime.start();
        expect(hooks.matcher.match).toHaveBeenCalled();
        expect(hooks.engine.init).toHaveBeenCalled();
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

    it('loads local XML before attempting DanDanPlay matching', async () => {
        danmakuState.useXmlDanmaku = true;
        const localComments: RawComment[] = [
            { time: 3, modeId: 1, color: 0xffffff, text: 'local' },
        ];
        vi.mocked(hooks.getLocalComments!).mockResolvedValue(localComments);

        await runtime.start();

        expect(hooks.getLocalComments).toHaveBeenCalledWith(
            'i1',
            expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
        expect(hooks.matcher.match).not.toHaveBeenCalled();
        expect(hooks.fetcher.fetch).not.toHaveBeenCalled();
        expect(hooks.engine.init).toHaveBeenCalledWith(expect.anything(), localComments);
        expect(danmakuState.episodeInfo).toBeNull();
    });

    it('falls back to online matching when local XML is empty', async () => {
        danmakuState.useXmlDanmaku = true;
        vi.mocked(hooks.getLocalComments!).mockResolvedValue([]);

        await runtime.start();

        expect(hooks.getLocalComments).toHaveBeenCalled();
        expect(hooks.matcher.match).toHaveBeenCalledWith(item, 'auto');
        expect(hooks.fetcher.fetch).toHaveBeenCalled();
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

    it('keeps current danmaku when a refresh match fails or is cancelled', async () => {
        await runtime.start();
        vi.mocked(hooks.matcher.match).mockResolvedValue(null);
        vi.mocked(hooks.engine.destroy).mockClear();

        await runtime.load('refresh');

        expect(hooks.engine.destroy).not.toHaveBeenCalled();
        expect(danmakuState.episodeInfo).toEqual(episode);
    });

    it('applies visibility and opacity instantly without rebuilding the engine', async () => {
        const setOpacity = vi.fn();
        hooks.engine.setOpacity = setOpacity;
        await runtime.start();
        vi.mocked(hooks.engine.init).mockClear();

        danmakuState.update({ danmakuSwitch: false });
        danmakuState.update({ danmakuSwitch: true });
        danmakuState.update({ opacity: 0.4 });

        expect(hooks.engine.hide).toHaveBeenCalledTimes(1);
        expect(hooks.engine.show).toHaveBeenCalledTimes(1);
        expect(setOpacity).toHaveBeenCalledWith(0.4);
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(hooks.engine.init).not.toHaveBeenCalled();
    });

    it('rebuilds from cached comments (no network) for style and filter changes, debounced', async () => {
        await runtime.start();
        vi.mocked(hooks.engine.init).mockClear();
        vi.mocked(hooks.fetcher.fetch).mockClear();

        danmakuState.update({ fontSize: 30 });
        danmakuState.update({ fontSize: 32 });
        danmakuState.update({ sourceFilter: { bilibili: false, gamer: true, dandanplay: true, other: true } });

        await vi.waitFor(() => expect(hooks.engine.init).toHaveBeenCalledTimes(1));
        expect(hooks.engine.init).toHaveBeenCalledWith(expect.anything(), comments);
        expect(hooks.fetcher.fetch).not.toHaveBeenCalled();
    });

    it('refetches when a network-affecting setting changes', async () => {
        await runtime.start();
        vi.mocked(hooks.fetcher.fetch).mockClear();

        danmakuState.update({ chConvert: 1 });

        await vi.waitFor(() => expect(hooks.fetcher.fetch).toHaveBeenCalledTimes(1), { timeout: 2000 });
    });

    it('persists settings immediately', () => {
        danmakuState.update({ speed: 320 });
        expect(JSON.parse(localStorage.getItem('jellyfin_danmaku_config')!).speed).toBe(320);
    });

    it('posts a danmaku and emits it locally at current playback time', async () => {
        hooks.auth.isLoggedIn = true;
        hooks.auth.token = 'tok';
        hooks.auth.userName = 'alice';
        const media = hooks.getMedia();
        if (media.video) media.video.currentTime = 12.5;

        await runtime.start();
        vi.mocked(hooks.engine.emit).mockClear();

        eventBus.emit('danmaku:send', { text: 'hello', mode: 5, color: 0xffffff });
        await vi.waitFor(() => expect(hooks.postComment).toHaveBeenCalled());

        expect(hooks.postComment).toHaveBeenCalledWith(
            danmakuState.effectiveApiPrefix,
            42,
            { text: 'hello', time: 12.5, mode: 5, color: 0xffffff },
            'tok',
        );
        expect(hooks.engine.emit).toHaveBeenCalledWith(
            expect.objectContaining({ text: 'hello', time: 12.5, mode: 'top' }),
        );
    });

    it('announces the match with a toast and records loaded counts', async () => {
        const toasts: string[] = [];
        eventBus.on('ui:toast', ({ message }) => toasts.push(message));
        await runtime.start();
        expect(toasts).toContain('A - E1 · 1 条弹幕');
        expect(danmakuState.loadedSource).toBe('online');
        expect(danmakuState.loadedCount).toBe(1);
    });

    it('hints manual search when the initial match fails', async () => {
        const toasts: string[] = [];
        eventBus.on('ui:toast', ({ message }) => toasts.push(message));
        vi.mocked(hooks.matcher.match).mockResolvedValue(null);
        await runtime.start();
        expect(toasts).toEqual(['未匹配到弹幕，可在弹幕设置中手动搜索']);
    });

    it('applies inherited episode offset before engine init', async () => {
        await Storage.setEpisodeOffset('s', 1, 2.5);
        vi.mocked(hooks.getCurrentItem).mockResolvedValue({ ...item, IndexNumber: 3 });
        await runtime.start();
        expect(danmakuState.curEpOffset).toBe(2.5);
    });

    it('saves the offset for the current episode as soon as it changes', async () => {
        await runtime.start();
        danmakuState.update({ curEpOffset: 4 });
        await vi.waitFor(() => expect(Storage.getEpisodeOffset('s', 1)).resolves.toBe(4));
    });

    it('submits danmaku on the server timeline when an episode offset is set', async () => {
        hooks.auth.isLoggedIn = true;
        hooks.auth.token = 'tok';
        await Storage.setEpisodeOffset('s', 1, 3);
        const media = hooks.getMedia();
        if (media.video) media.video.currentTime = 10;

        await runtime.start();
        eventBus.emit('danmaku:send', { text: 'hi', mode: 1, color: 0xffffff });
        await vi.waitFor(() => expect(hooks.postComment).toHaveBeenCalled());

        expect(vi.mocked(hooks.postComment!).mock.calls[0][2]).toMatchObject({ time: 7 });
        expect(hooks.engine.emit).toHaveBeenCalledWith(expect.objectContaining({ time: 10 }));
    });

    it('adds a source on top of local XML danmaku without posting related', async () => {
        danmakuState.useXmlDanmaku = true;
        hooks.auth.isLoggedIn = true;
        vi.mocked(hooks.getLocalComments!).mockResolvedValue([{ time: 1, modeId: 1, color: 0, text: 'local' }]);
        vi.mocked(hooks.getExtComments!).mockResolvedValue([{ cid: 2, p: '2,1,16777215,u', m: 'ext' }]);

        await runtime.start();
        vi.mocked(hooks.engine.init).mockClear();
        await runtime.addSource('https://example.com/video');

        expect(hooks.engine.init).toHaveBeenCalledWith(
            expect.anything(),
            expect.arrayContaining([
                expect.objectContaining({ text: 'local' }),
                expect.objectContaining({ text: 'ext' }),
            ]),
        );
        expect(hooks.postRelatedSource).not.toHaveBeenCalled();
    });

    it('does not reload local XML on refresh for the same item', async () => {
        danmakuState.useXmlDanmaku = true;
        vi.mocked(hooks.getLocalComments!).mockResolvedValue([{ time: 1, modeId: 1, color: 0, text: 'local' }]);

        await runtime.start();
        await runtime.load('refresh');

        expect(hooks.getLocalComments).toHaveBeenCalledTimes(1);
    });

    it('records a readable load error and clears it after a successful retry', async () => {
        vi.mocked(hooks.fetcher.fetch).mockRejectedValueOnce(
            new DanmakuError('HTTP 429: {"errorCode":429,"errorMessage":"代理今日回源配额已达到保护上限"}', ErrorCode.HttpError),
        );
        await runtime.start();
        expect(danmakuState.loadError).toBe('代理今日回源配额已达到保护上限（HTTP 429）');

        await runtime.load('refresh');
        expect(danmakuState.loadError).toBeNull();
        expect(danmakuState.loadedSource).toBe('online');
    });

    it('falls back to plugin XML danmaku when online matching finds nothing', async () => {
        vi.mocked(hooks.matcher.match).mockResolvedValue(null);
        vi.mocked(hooks.getLocalComments!).mockResolvedValue([{ time: 1, modeId: 1, color: 0, text: 'plugin' }]);

        await runtime.start();

        expect(hooks.getLocalComments).toHaveBeenCalledWith('i1', expect.anything());
        expect(danmakuState.loadedSource).toBe('local');
    });

    it('does not fall back on a manual search, or when the fallback is disabled', async () => {
        vi.mocked(hooks.getLocalComments!).mockResolvedValue([{ time: 1, modeId: 1, color: 0, text: 'plugin' }]);
        await runtime.start();
        vi.mocked(hooks.matcher.match).mockResolvedValue(null);
        vi.mocked(hooks.getLocalComments!).mockClear();

        await runtime.load('search');
        danmakuState.xmlFallback = false;
        await runtime.load('reload');

        expect(hooks.getLocalComments).not.toHaveBeenCalled();
    });

    it('records source stats for the loaded comments', async () => {
        vi.mocked(hooks.fetcher.fetch).mockResolvedValue([
            { time: 1, modeId: 1, color: 0, text: 'a', user: '[bilibili]x' },
            { time: 2, modeId: 1, color: 0, text: 'b', user: 'ddp' },
        ]);
        await runtime.start();
        expect(danmakuState.sourceStats).toEqual({ total: 2, bilibili: 1, gamer: 0, dandanplay: 1, other: 0 });
    });

    it('clears episode mappings when the API prefix changes, then refetches', async () => {
        const clear = vi.spyOn(Storage, 'clearEpisodeMappings');
        await runtime.start();
        vi.mocked(hooks.fetcher.fetch).mockClear();

        danmakuState.update({ customApiPrefix: 'http://misaka:7768/api/v1/token' });

        await vi.waitFor(() => expect(hooks.fetcher.fetch).toHaveBeenCalledTimes(1), { timeout: 2000 });
        expect(clear).toHaveBeenCalled();
        clear.mockRestore();
    });

    it('rebuilds locally when block rules change', async () => {
        await runtime.start();
        vi.mocked(hooks.engine.init).mockClear();
        vi.mocked(hooks.fetcher.fetch).mockClear();

        danmakuState.update({ blockKeywords: '剧透' });

        await vi.waitFor(() => expect(hooks.engine.init).toHaveBeenCalledTimes(1));
        expect(hooks.fetcher.fetch).not.toHaveBeenCalled();
    });

    it('does not re-render the previous episode while a new item is loading', async () => {
        await runtime.start();
        vi.mocked(hooks.engine.init).mockClear();

        danmakuState.itemId = 'ffffffffffffffffffffffffffffffff';
        danmakuState.update({ fontSize: 40 });
        await new Promise((resolve) => setTimeout(resolve, 300));

        expect(hooks.engine.init).not.toHaveBeenCalled();
    });

    it('remounts the engine when its container is detached', async () => {
        vi.useFakeTimers({ toFake: ['setInterval'] });
        let mounted = true;
        hooks.engine.isMounted = () => mounted;
        await runtime.start();
        vi.mocked(hooks.engine.init).mockClear();

        mounted = false;
        vi.advanceTimersByTime(2000);
        expect(hooks.engine.init).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(10000);
        expect(hooks.engine.init).toHaveBeenCalledTimes(3);
        vi.useRealTimers();
    });
});

describe('describeLoadError', () => {
    it('falls back to status code or error category', () => {
        expect(describeLoadError(new DanmakuError('HTTP 502: <html>', ErrorCode.HttpError))).toBe('服务器返回 HTTP 502');
        expect(describeLoadError(new DanmakuError('Request timeout after 10000ms', ErrorCode.Timeout))).toBe('请求超时');
        expect(describeLoadError(new Error('boom'))).toBe('boom');
    });
});
