import { logger } from '../../core/logger';

/**
 * 安装 PlaybackInfo XHR 拦截器
 *
 * 拦截 XMLHttpRequest 对 PlaybackInfo 端点的响应，
 * 从中提取当前媒体项的 Id。
 *
 * @returns 清理函数（恢复原始 XHR.open）
 */
export function interceptPlaybackInfo(onItemId: (id: string) => void): () => void {
    const originalOpen = XMLHttpRequest.prototype.open;

    XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...args: unknown[]) {
        const urlStr = url.toString();

        if (urlStr.includes('PlaybackInfo')) {
            this.addEventListener('load', function () {
                try {
                    const data = JSON.parse(this.responseText);
                    const id = data?.MediaSources?.[0]?.Id;

                    if (typeof id === 'string' && id.length > 0) {
                        logger.debug('interceptor', `Captured itemId from PlaybackInfo: ${id}`);
                        onItemId(id);
                    }
                } catch (error) {
                    logger.warn('interceptor', 'Failed to parse PlaybackInfo response', error);
                }
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
