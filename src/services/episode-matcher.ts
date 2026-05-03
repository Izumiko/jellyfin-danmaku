import { searchEpisodes } from './dandanplay/client';
import { Storage } from '../core/storage';
import { logger } from '../core/logger';
import type { EpisodeInfo, JellyfinItem, ChConvertMode } from '../types/index';

export interface EpisodeMatcherDeps {
    apiPrefix: string;
    chConvert: ChConvertMode;
    showSelectDialog?: (title: string, options: string[], defaultIndex?: number) => Promise<number | null>;
}

/**
 * 剧集匹配器
 * 负责将 Jellyfin 媒体项匹配到 DanDanPlay 剧集
 */
export class EpisodeMatcher {
    constructor(private deps: EpisodeMatcherDeps) {}

    /**
     * 匹配剧集
     * @param item Jellyfin 媒体项
     * @param mode 'auto' 自动匹配 | 'manual' 手动选择
     */
    async match(item: JellyfinItem, mode: 'auto' | 'manual' = 'auto'): Promise<EpisodeInfo | null> {
        try {
            // 1. 检查缓存
            if (item.SeasonId && item.IndexNumber !== undefined) {
                const cached = Storage.getEpisodeCache(item.SeasonId, item.IndexNumber);
                if (cached) {
                    logger.info('matcher', `Using cached episode: ${cached.animeTitle} - ${cached.episodeTitle}`);
                    return {
                        episodeId: cached.episodeId,
                        animeTitle: cached.animeTitle,
                        episodeTitle: cached.episodeTitle,
                    };
                }
            }

            // 2. 搜索动画
            const animeName = item.SeriesName || item.Name;
            logger.info('matcher', `Searching for: ${animeName}`);

            let searchResult = await searchEpisodes(this.deps.apiPrefix, animeName);

            // 如果没有结果，尝试使用 OriginalTitle
            if ((!searchResult.animes || searchResult.animes.length === 0) && item.OriginalTitle) {
                logger.info('matcher', `Retrying with OriginalTitle: ${item.OriginalTitle}`);
                searchResult = await searchEpisodes(this.deps.apiPrefix, item.OriginalTitle);
            }

            if (!searchResult.animes || searchResult.animes.length === 0) {
                logger.warn('matcher', 'No anime found');
                return null;
            }

            // 3. 选择动画
            let selectedAnime = searchResult.animes[0];

            if (mode === 'manual' && this.deps.showSelectDialog && searchResult.animes.length > 1) {
                const options = searchResult.animes.map((a) => `${a.animeTitle} (${a.type})`);
                const selectedIndex = await this.deps.showSelectDialog('选择动画', options, 0);

                if (selectedIndex === null || selectedIndex < 0) {
                    return null;
                }

                selectedAnime = searchResult.animes[selectedIndex];
            }

            // 4. 匹配剧集
            const episodeIndex = item.IndexNumber || 1;
            const episode =
                selectedAnime.episodes.find((ep) => {
                    const match = ep.episodeTitle.match(/第(\d+)集/);
                    return match && parseInt(match[1]) === episodeIndex;
                }) || selectedAnime.episodes[episodeIndex - 1];

            if (!episode) {
                logger.warn('matcher', `Episode ${episodeIndex} not found`);
                return null;
            }

            const result: EpisodeInfo = {
                episodeId: episode.episodeId,
                animeTitle: selectedAnime.animeTitle,
                episodeTitle: episode.episodeTitle,
            };

            // 5. 缓存结果
            if (item.SeasonId && item.IndexNumber !== undefined) {
                Storage.setEpisodeCache(item.SeasonId, item.IndexNumber, {
                    ...result,
                    timestamp: Date.now(),
                });
            }

            logger.info('matcher', `Matched: ${result.animeTitle} - ${result.episodeTitle}`);
            return result;
        } catch (error) {
            logger.error('matcher', 'Match failed', error);
            return null;
        }
    }
}
