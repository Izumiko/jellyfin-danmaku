import { get } from '../http';
import { logger } from '../../core/logger';
import type { RawComment } from '../../types/index';

/**
 * 从 Jellyfin 弹幕插件获取本地 XML 弹幕
 *
 * 需要安装 jellyfin-plugin-danmu 插件
 * https://github.com/cxfksword/jellyfin-plugin-danmu
 */
export async function getLocalXmlDanmaku(
    jellyfinItemId: string,
    options?: { signal?: AbortSignal },
): Promise<RawComment[]> {
    try {
        const url = `${location.origin}/api/danmu/${jellyfinItemId}/raw`;
        logger.debug('jellyfin', `Fetching local XML danmaku from ${url}`);

        const xml = await get<string>(url, {
            timeout: 5000,
            retries: 1,
            signal: options?.signal,
        });

        return parseXmlDanmaku(xml);
    } catch (error) {
        logger.warn('jellyfin', 'Failed to fetch local XML danmaku', error);
        throw error;
    }
}

/**
 * 解析 XML 弹幕
 *
 * XML 格式：
 * <d p="time,mode,fontSize,color,timestamp,pool,sender,dbid">弹幕内容</d>
 */
function parseXmlDanmaku(xml: string): RawComment[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');

    // 检查解析错误
    const parserError = doc.querySelector('parsererror');
    if (parserError) {
        throw new Error('Invalid XML danmaku data');
    }

    const comments: RawComment[] = [];
    const elements = doc.querySelectorAll('d');

    elements.forEach((element) => {
        const p = element.getAttribute('p');
        const text = element.textContent;

        if (!p || !text) return;

        const parts = p.split(',');
        if (parts.length < 4) return;

        const time = parseFloat(parts[0]);
        const modeId = parseInt(parts[1], 10);
        const color = parseInt(parts[3], 10);

        if (isNaN(time) || isNaN(modeId) || isNaN(color)) return;

        comments.push({
            time,
            modeId,
            color,
            text: text.trim(),
        });
    });

    logger.info('jellyfin', `Parsed ${comments.length} comments from local XML`);
    return comments;
}
