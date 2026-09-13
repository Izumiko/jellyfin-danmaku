import { searchEpisodes } from './dandanplay/client';
import { Storage } from '../core/storage';
import { logger } from '../core/logger';
import type { EpisodeInfo, JellyfinItem, ChConvertMode } from '../types/index';

export interface EpisodeMatcherDeps {
    apiPrefix: string;
    chConvert: ChConvertMode;
    showInputDialog: (title: string, placeholder: string, defaultValue?: string) => Promise<string | null>;
    showSelectDialog: (title: string, options: string[], defaultIndex?: number) => Promise<number | null>;
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
            if (mode === 'auto' && item.SeasonId && item.IndexNumber !== undefined) {
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

            let animeName = item.SeriesName || item.Name;
            if ((item.ParentIndexNumber ?? 1) > 1) {
                animeName += String(item.ParentIndexNumber);
            }

            if (mode === 'manual') {
                const input = await this.deps.showInputDialog('确认动画名', '请输入动画名称', animeName);
                if (input === null) {
                    return null;
                }
                animeName = input;
            }

            logger.info('matcher', `Searching for: ${animeName}`);

            let searchResult = await searchEpisodes(this.deps.apiPrefix, animeName);

            if ((!searchResult.animes || searchResult.animes.length === 0) && item.OriginalTitle) {
                logger.info('matcher', `Retrying with OriginalTitle: ${item.OriginalTitle}`);
                searchResult = await searchEpisodes(this.deps.apiPrefix, item.OriginalTitle);
            }

            if (!searchResult.animes || searchResult.animes.length === 0) {
                logger.warn('matcher', 'No anime found');
                return null;
            }

            let selectedAnime = searchResult.animes[0];
            let selectedEpisodeIndex: number;

            if (mode === 'manual') {
                const animeIndex = await this.deps.showSelectDialog(
                    '选择节目',
                    searchResult.animes.map((a) => `${a.animeTitle} 类型:${a.type}`),
                    0,
                );
                if (animeIndex === null) {
                    return null;
                }
                selectedAnime = searchResult.animes[animeIndex];

                const episodeIndex = await this.deps.showSelectDialog(
                    '选择剧集',
                    selectedAnime.episodes.map((e) => e.episodeTitle),
                    (item.IndexNumber || 1) - 1,
                );
                if (episodeIndex === null) {
                    return null;
                }
                selectedEpisodeIndex = episodeIndex;
            } else {
                const firstTitle = selectedAnime.episodes[0]?.episodeTitle ?? '';
                const huaMatch = firstTitle.match(/第(\d+)话/);
                const jiMatch = firstTitle.match(/第(\d+)集/);
                let initialEp = 1;
                if (huaMatch) {
                    initialEp = parseInt(huaMatch[1], 10);
                } else if (jiMatch) {
                    initialEp = parseInt(jiMatch[1], 10);
                }
                const numeric = item.IndexNumber || 1;
                const episode = numeric < initialEp ? numeric : numeric - initialEp + 1;
                selectedEpisodeIndex = episode - 1;
            }

            const episode = selectedAnime.episodes[selectedEpisodeIndex];
            if (!episode) {
                logger.warn('matcher', `Episode ${item.IndexNumber || 1} not found`);
                return null;
            }

            const result: EpisodeInfo = {
                episodeId: episode.episodeId,
                animeTitle: selectedAnime.animeTitle,
                episodeTitle: episode.episodeTitle,
            };

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
