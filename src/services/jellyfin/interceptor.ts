import { logger } from '../../core/logger';

export function itemIdFromPlaybackInfoUrl(url: string): string | null {
    const match = url.match(/\/Items\/([^/?]+)\/PlaybackInfo/i);
    return match?.[1] ?? null;
}

/**
 * 安装 PlaybackInfo XHR 拦截器
 *
 * 拦截 XMLHttpRequest 对 PlaybackInfo 端点的请求 URL（Item Id），
 * 响应里的 MediaSources[0].Id 是 MediaSource Id，不能当 Item Id。
 *
 * @returns 清理函数（恢复原始 XHR.open）
 */
export function interceptPlaybackInfo(onItemId: (id: string) => void): () => void {
    const originalOpen = XMLHttpRequest.prototype.open;

    XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...args: unknown[]) {
        const urlStr = url.toString();
        const itemId = itemIdFromPlaybackInfoUrl(urlStr);

        if (itemId) {
            this.addEventListener('load', () => {
                logger.debug('interceptor', `Captured itemId from PlaybackInfo URL: ${itemId}`);
                onItemId(itemId);
            });
        }

        // @ts-expect-error - XMLHttpRequest.open 参数类型复杂
        return originalOpen.call(this, method, url, ...args);
    };

    logger.info('interceptor', 'PlaybackInfo interceptor installed');

    // 返回清理函数
    return () => {
        XMLHttpRequest.prototype.open = originalOpen;
        logger.info('interceptor', 'PlaybackInfo interceptor removed');
    };
}
