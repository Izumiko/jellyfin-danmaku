import { searchEpisodes, getAnimeById } from './dandanplay/client';
import { Storage, episodeScope } from '../core/storage';
import { logger } from '../core/logger';
import { eventBus } from '../core/event-bus';
import { extractEpisodeNumber, pickBestAnime } from './title-match';
import type { AnimeInfo, EpisodeInfo, JellyfinItem, ChConvertMode } from '../types/index';

export interface EpisodeMatcherDeps {
    apiPrefix: string;
    chConvert: ChConvertMode;
    showInputDialog: (title: string, placeholder: string, defaultValue?: string) => Promise<string | null>;
    showSelectDialog: (title: string, options: string[], defaultIndex?: number) => Promise<number | null>;
    getSeriesOriginalTitle?: (item: JellyfinItem) => Promise<string | undefined>;
}

function jellyfinEpisodeNumber(item: JellyfinItem): number {
    return item.IndexNumber && item.IndexNumber > 0 ? Math.floor(item.IndexNumber) : 1;
}

/**
 * 在不了解偏移时选择剧集：
 * 1. episodeNumber 字段精确匹配
 * 2. 标题里的集号精确匹配（第N话 / SxxExx / 裸数字）——源站缺集时不会整体错位
 * 3. 以首集集号为起点顺序推算（ede.js 原逻辑）
 */
export function selectEpisodeIndex(anime: AnimeInfo, indexNumber?: number): number {
    const numeric = indexNumber && indexNumber > 0 ? Math.floor(indexNumber) : 1;

    const byNumber = anime.episodes.findIndex((episode) => Number(episode.episodeNumber) === numeric);
    if (byNumber >= 0) return byNumber;

    const byTitle = anime.episodes.findIndex((episode) => extractEpisodeNumber(episode.episodeTitle) === numeric);
    if (byTitle >= 0) return byTitle;

    const initialEp = extractEpisodeNumber(anime.episodes[0]?.episodeTitle) ?? 1;
    return numeric < initialEp ? numeric - 1 : numeric - initialEp;
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
            const { seasonId, episodeIndex: cacheIndex } = episodeScope(item);

            if (mode === 'auto') {
                const cached = await Storage.getEpisodeCache(seasonId, cacheIndex);
                if (cached) {
                    logger.info('matcher', `Using cached episode: ${cached.animeTitle} - ${cached.episodeTitle}`);
                    return {
                        episodeId: cached.episodeId,
                        animeTitle: cached.animeTitle,
                        episodeTitle: cached.episodeTitle,
                    };
                }
            }

            const remembered = await Storage.getSeasonAnime(seasonId);

            // 已知 animeId：直接按 id 拉取剧集，避免完整标题在 DanDanPlay 搜不到
            if (remembered && mode === 'auto') {
                // 自定义 API（如御坂网络）可能不支持 /bangumi，失败时回退到标题搜索
                const anime = await getAnimeById(this.deps.apiPrefix, remembered.animeId).catch((error) => {
                    logger.warn('matcher', `animeId ${remembered.animeId} lookup failed, falling back to search`, error);
                    return null;
                });
                if (anime) {
                    logger.info('matcher', `Using animeId ${remembered.animeId}: ${anime.animeTitle}`);
                    // 沿用首次匹配学到的集数偏移，保证「前一集偏移多少，后面就偏移多少」
                    let episodeIndex =
                        remembered.episodeIndexOffset !== undefined
                            ? jellyfinEpisodeNumber(item) - 1 + remembered.episodeIndexOffset
                            : selectEpisodeIndex(anime, item.IndexNumber);
                    if (!anime.episodes[episodeIndex]) {
                        episodeIndex = selectEpisodeIndex(anime, item.IndexNumber);
                    }
                    return this.commit(seasonId, anime, item, episodeIndex);
                }
            }

            // 首次匹配或手动重新匹配：按标题搜索
            let animeName = remembered?.animeTitle || item.SeriesName || item.Name;
            if (!remembered && (item.ParentIndexNumber ?? 1) > 1) {
                animeName += String(item.ParentIndexNumber);
            }

            if (mode === 'manual') {
                const input = await this.deps.showInputDialog('确认动画名', '请输入动画名称', animeName);
                if (input === null) {
                    return null;
                }
                // 御坂网络等服务端把 @HELP / @QLHC 之类的指令藏在搜索关键词里，不能当番剧名发出去
                if (input.trim().startsWith('@')) {
                    logger.warn('matcher', 'Search keyword must not start with "@" (reserved for server commands)');
                    eventBus.emit('ui:toast', { message: '搜索关键词不能以 @ 开头（会被当作服务端指令）', tone: 'error' });
                    return null;
                }
                animeName = input;
            }

            logger.info('matcher', `Searching for: ${animeName}`);

            let searchedName = animeName;
            let searchResult = await searchEpisodes(this.deps.apiPrefix, animeName);
            if (!searchResult.animes || searchResult.animes.length === 0) {
                const originalTitle =
                    (await this.deps.getSeriesOriginalTitle?.(item)) || item.OriginalTitle;
                if (originalTitle && originalTitle !== animeName) {
                    logger.info('matcher', `Retrying with series OriginalTitle: ${originalTitle}`);
                    searchedName = originalTitle;
                    searchResult = await searchEpisodes(this.deps.apiPrefix, originalTitle);
                }
            }

            if (!searchResult.animes || searchResult.animes.length === 0) {
                logger.warn('matcher', 'No anime found');
                if (mode === 'manual') eventBus.emit('ui:toast', { message: `没有找到「${searchedName}」`, tone: 'error' });
                return null;
            }

            let selectedAnime = searchResult.animes[0];
            const found = remembered && searchResult.animes.find((a) => a.animeId === remembered.animeId);
            if (found) {
                selectedAnime = found;
            } else if (searchResult.animes.length > 1) {
                const best = pickBestAnime(searchResult.animes, searchedName);
                selectedAnime = searchResult.animes[best.index];
                logger.info('matcher', `Picked by title similarity: ${selectedAnime.animeTitle} (${Math.round(best.score)})`);
            }

            let episodeIndex: number;
            if (mode === 'manual') {
                const animeIndex = await this.deps.showSelectDialog(
                    '选择节目',
                    searchResult.animes.map((a) => `${a.animeTitle} 类型:${a.typeDescription ?? a.type}`),
                    Math.max(0, searchResult.animes.indexOf(selectedAnime)),
                );
                if (animeIndex === null) {
                    return null;
                }
                selectedAnime = searchResult.animes[animeIndex];

                const selected = await this.deps.showSelectDialog(
                    '选择剧集',
                    selectedAnime.episodes.map((e) => e.episodeTitle),
                    (item.IndexNumber || 1) - 1,
                );
                if (selected === null) {
                    return null;
                }
                episodeIndex = selected;
            } else {
                episodeIndex = selectEpisodeIndex(selectedAnime, item.IndexNumber);
            }

            return this.commit(seasonId, selectedAnime, item, episodeIndex);
        } catch (error) {
            logger.error('matcher', 'Match failed', error);
            return null;
        }
    }

    private async commit(seasonId: string, anime: AnimeInfo, item: JellyfinItem, episodeIndex: number): Promise<EpisodeInfo | null> {
        const episode = anime.episodes[episodeIndex];
        if (!episode) {
            logger.warn('matcher', `Episode ${item.IndexNumber || 1} not found in ${anime.animeTitle}`);
            return null;
        }

        const result: EpisodeInfo = {
            episodeId: episode.episodeId,
            animeTitle: anime.animeTitle,
            episodeTitle: episode.episodeTitle,
        };

        await Storage.setSeasonAnime(seasonId, {
            animeId: anime.animeId,
            animeTitle: anime.animeTitle,
            episodeIndexOffset: episodeIndex - (jellyfinEpisodeNumber(item) - 1),
        });
        await Storage.setEpisodeCache(seasonId, episodeScope(item).episodeIndex, { ...result, timestamp: Date.now() });

        logger.info('matcher', `Matched: ${result.animeTitle} - ${result.episodeTitle}`);
        return result;
    }
}
