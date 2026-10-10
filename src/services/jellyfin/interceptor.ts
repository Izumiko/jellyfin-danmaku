import { logger } from '../../core/logger';

/** 播放相关请求：PlaybackInfo、直接播放的 stream、HLS 的 master/main.m3u8 */
const ITEM_ID_URL = /\/(?:Items|Videos)\/([0-9a-f]{32}|[0-9a-f-]{36})\/(?:PlaybackInfo|stream(?:\.[a-z0-9]+)?|master\.m3u8|main\.m3u8)(?:[/?#]|$)/i;

/**
 * 从播放相关请求地址中取当前条目 id（统一为不带横线的 32 位小写形式）。
 * 注意：PlaybackInfo 响应里的 MediaSources[0].Id 是媒体源 id，不能当条目 id。
 */
export function itemIdFromUrl(url: string): string | null {
    const match = String(url || '').match(ITEM_ID_URL);
    return match ? match[1].replace(/-/g, '').toLowerCase() : null;
}

/**
 * 捕获当前播放条目 id：
 * - XMLHttpRequest（旧版 ApiClient）
 * - fetch（Jellyfin 10.10+ / 12 的 ApiClient）
 * - <video> loadstart（直接播放换集时 video.src 不经过 XHR/fetch）
 *
 * 只在 id 变化时回调。
 * @returns 清理函数（恢复原始 XHR.open / fetch，移除监听）
 */
export function interceptPlaybackInfo(onItemId: (id: string) => void): () => void {
    let lastId: string | null = null;
    const capture = (url: unknown, via: string) => {
        const id = itemIdFromUrl(String(url ?? ''));
        if (!id || id === lastId) return;
        lastId = id;
        logger.debug('interceptor', `Captured itemId via ${via}: ${id}`);
        onItemId(id);
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...args: unknown[]) {
        capture(url, 'XHR');
        // @ts-expect-error - XMLHttpRequest.open 参数类型复杂
        return originalOpen.call(this, method, url, ...args);
    };

    const originalFetch = window.fetch;
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
        capture(typeof input === 'string' || input instanceof URL ? input : input?.url, 'fetch');
        return originalFetch.call(this, input, init);
    };

    // 媒体事件不冒泡，用捕获阶段在 document 上统一监听
    const onLoadStart = (event: Event) => {
        if (event.target instanceof HTMLVideoElement) capture(event.target.currentSrc, 'loadstart');
    };
    document.addEventListener('loadstart', onLoadStart, true);

    logger.info('interceptor', 'Playback item interceptor installed');

    return () => {
        XMLHttpRequest.prototype.open = originalOpen;
        window.fetch = originalFetch;
        document.removeEventListener('loadstart', onLoadStart, true);
        logger.info('interceptor', 'Playback item interceptor removed');
    };
}
