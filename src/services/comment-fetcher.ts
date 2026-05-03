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
            return [];
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

        // 2. 获取关联源
        try {
            const relatedSources = await getRelatedSources(this.deps.apiPrefix, episodeId, options);

            // 3. 按来源过滤
            const filteredSources = relatedSources.filter((source) => {
                const url = source.url.toLowerCase();

                if (url.includes('bilibili.com')) return this.deps.sourceFilter.bilibili;
                if (url.includes('gamer') || url.includes('bahamut')) return this.deps.sourceFilter.gamer;

                return this.deps.sourceFilter.other;
            });

            logger.info('fetcher', `Found ${filteredSources.length} related sources`);

            // 4. 获取外部弹幕
            for (const source of filteredSources) {
                try {
                    const extComments = await getExtComments(this.deps.apiPrefix, source.url, { chConvert: this.deps.chConvert }, options);

                    allComments.push(...extComments.map(convertDanDanPlayComment));
                    logger.debug('fetcher', `Loaded ${extComments.length} comments from ${source.url}`);
                } catch (error) {
                    logger.warn('fetcher', `Failed to load from ${source.url}`, error);
                }
            }
        } catch (error) {
            logger.warn('fetcher', 'Failed to load related sources', error);
        }

        logger.info('fetcher', `Total ${allComments.length} comments loaded`);
        return allComments;
    }
}
