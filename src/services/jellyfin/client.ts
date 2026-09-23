import { logger } from '../../core/logger';
import type { JellyfinItem } from '../../types/index';
import '../../types/jellyfin.d.ts';

/**
 * 安全获取 ApiClient
 * 带空值检查
 */
export function getApiClient() {
    return window.ApiClient ?? null;
}

/**
 * 等待 ApiClient 就绪
 * 最多等待 5 秒
 */
export async function waitForApiClient(timeout = 5000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
        const client = getApiClient();
        if (client) {
            logger.debug('jellyfin', 'ApiClient ready');
            return client;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error('ApiClient not available after timeout');
}

/**
 * 获取当前播放的媒体项信息
 * 自动适配 Jellyfin 10.10.0 前后的 API 差异
 */
export async function getCurrentItem(isNewJellyfin: boolean, itemId: string): Promise<JellyfinItem | null> {
    const client = getApiClient();
    if (!client) {
        logger.warn('jellyfin', 'ApiClient not available');
        return null;
    }

    try {
        if (isNewJellyfin && itemId) {
            const userId = client.getCurrentUserId();
            logger.debug('jellyfin', `Getting item ${itemId} for user ${userId}`);
            const item = await client.getItem(userId, itemId);
            if (item) return item;
        }

        const deviceId = client.deviceId();
        const userId = client.getCurrentUserId();
        logger.debug('jellyfin', `Getting current item from session (device: ${deviceId})`);
        const sessions = await client.getSessions({ userId, deviceId });
        return sessions?.[0]?.NowPlayingItem ?? null;
    } catch (error) {
        logger.error('jellyfin', 'Failed to get current item', error);
        return null;
    }
}

/**
 * 获取当前媒体所属 Series 的 OriginalTitle。
 * ede.js 在主标题搜索无结果时会读取 Series 项，而不是直接使用 episode.OriginalTitle。
 */
export async function getSeriesOriginalTitle(item: JellyfinItem): Promise<string | undefined> {
    const client = getApiClient();
    if (!client) return item.OriginalTitle;

    const seriesId = item.SeriesId || item.Id;
    try {
        const series = await client.getItem(client.getCurrentUserId(), seriesId);
        return series?.OriginalTitle || item.OriginalTitle;
    } catch (error) {
        logger.warn('jellyfin', 'Failed to get series OriginalTitle', error);
        return item.OriginalTitle;
    }
}

/**
 * 检测 Jellyfin 版本
 */
export function detectJellyfinVersion(): { isNewJellyfin: boolean; version: string } {
    const client = getApiClient();
    if (!client) {
        return { isNewJellyfin: false, version: 'unknown' };
    }

    const version = client._appVersion || 'unknown';
    // 简单比较：10.10.0 及以上为新版本
    const isNewJellyfin = compareVersion(version, '10.10.0') >= 0;

    logger.info('jellyfin', `Detected Jellyfin version: ${version} (new API: ${isNewJellyfin})`);

    return { isNewJellyfin, version };
}

/**
 * 简单的版本比较
 */
function compareVersion(v1: string, v2: string): number {
    const parts1 = v1.split('.').map((n) => parseInt(n, 10) || 0);
    const parts2 = v2.split('.').map((n) => parseInt(n, 10) || 0);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const num1 = parts1[i] || 0;
        const num2 = parts2[i] || 0;
        if (num1 !== num2) return num1 - num2;
    }

    return 0;
}
