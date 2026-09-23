import { getComments, getRelatedSources, getExtComments, convertDanDanPlayComment } from './dandanplay/client';
import { getLocalXmlDanmaku } from './jellyfin/danmaku';
import { logger } from '../core/logger';
import type { RawComment, ChConvertMode, SourceFilter } from '../types/index';

export interface CommentFetcherDeps {
    apiPrefix: string;
    chConvert: ChConvertMode;
    sourceFilter: SourceFilter;
    useXmlDanmaku: boolean;
}

/**
 * 弹幕获取编排器
 * 负责从多个来源获取弹幕并合并
 */
export class CommentFetcher {
    constructor(private deps: CommentFetcherDeps) {}

    /**
     * 获取弹幕
     * @param episodeId DanDanPlay 剧集 ID
     * @param jellyfinItemId Jellyfin 媒体项 ID
     * @param options 选项
     */
    async fetch(episodeId: number, jellyfinItemId: string, options?: { signal?: AbortSignal }): Promise<RawComment[]> {
        try {
            // 1. 如果启用本地 XML，先尝试本地
            if (this.deps.useXmlDanmaku) {
                try {
                    const localComments = await getLocalXmlDanmaku(jellyfinItemId, options);
                    if (localComments.length > 0) {
                        logger.info('fetcher', `Loaded ${localComments.length} comments from local XML`);
                        return localComments;
                    }
                } catch (error) {
                    logger.warn('fetcher', 'Local XML fetch failed, falling back to online', error);
                }
            }

            // 2. 在线获取
            return await this.fetchOnline(episodeId, options);
        } catch (error) {
            logger.error('fetcher', 'Fetch failed', error);
            throw error;
        }
    }

    /**
     * 从 DanDanPlay 在线获取
     */
    private async fetchOnline(episodeId: number, options?: { signal?: AbortSignal }): Promise<RawComment[]> {
        const allComments: RawComment[] = [];

        // 1. 获取主弹幕
        const mainComments = await getComments(
            this.deps.apiPrefix,
            episodeId,
            {
                chConvert: this.deps.chConvert,
                withRelated: true,
            },
            options,
        );

        allComments.push(...mainComments.map(convertDanDanPlayComment));
        logger.info('fetcher', `Loaded ${mainComments.length} main comments`);

        const hasBilibiliInMain =
            this.deps.sourceFilter.bilibili &&
            mainComments.some((comment) => (comment.p.split(',')[3] ?? '').startsWith('[BiliBili]'));

        // 2. 获取关联源
        try {
            const relatedSources = await getRelatedSources(this.deps.apiPrefix, episodeId, options);

            // 3. 按来源过滤
            const filteredSources = relatedSources.filter((source) => {
                const url = source.url.toLowerCase();

                // ede.js 中 withRelated=true 的主请求通常已经包含番剧 Bilibili 弹幕；
                // 若主结果已有 [BiliBili]，避免再次抓 bangumi 源造成重复。
                if (url.includes('bilibili.com/bangumi')) {
                    return this.deps.sourceFilter.bilibili && !hasBilibiliInMain;
                }
                // 普通 Bilibili 视频源仍需单独抓取。
                if (url.includes('bilibili.com/video')) {
                    return this.deps.sourceFilter.bilibili;
                }
                if (url.includes('gamer') || url.includes('bahamut')) {
                    return this.deps.sourceFilter.gamer;
                }

                return this.deps.sourceFilter.other;
            });

            logger.info('fetcher', `Found ${filteredSources.length} related sources`);

            // 4. 并行获取外部弹幕
            const extResults = await Promise.all(
                filteredSources.map(async (source) => {
                    try {
                        const extComments = await getExtComments(this.deps.apiPrefix, source.url, { chConvert: this.deps.chConvert }, options);
                        const converted = extComments.map((c) => {
                            const comment = convertDanDanPlayComment(c);
                            comment.time += source.shift || 0;
                            return comment;
                        });
                        logger.debug('fetcher', `Loaded ${extComments.length} comments from ${source.url}`);
                        return converted;
                    } catch (error) {
                        logger.warn('fetcher', `Failed to load from ${source.url}`, error);
                        return [];
                    }
                }),
            );
            allComments.push(...extResults.flat());
        } catch (error) {
            logger.warn('fetcher', 'Failed to load related sources', error);
        }

        logger.info('fetcher', `Total ${allComments.length} comments loaded`);
        return allComments;
    }
}
