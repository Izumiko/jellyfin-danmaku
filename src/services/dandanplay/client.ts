import { get, post } from '../http';
import { logger } from '../../core/logger';
import type { SearchResponse, BangumiResponse, AnimeInfo, DanDanPlayComment, RelatedSource, RawComment, ChConvertMode } from '../../types/index';

/**
 * 搜索剧集
 */
export async function searchEpisodes(apiPrefix: string, animeName: string, options?: { signal?: AbortSignal }): Promise<SearchResponse> {
    const url = `${apiPrefix}/api/v2/search/episodes?anime=${encodeURIComponent(animeName)}`;
    logger.debug('dandanplay', `Searching episodes: ${animeName}`);

    const response = await get<SearchResponse>(url, {
        timeout: 10000,
        retries: 2,
        signal: options?.signal,
    });

    logger.info('dandanplay', `Found ${response.animes?.length || 0} anime results for "${animeName}"`);
    return response;
}

/**
 * 通过 animeId 获取动画剧集列表
 * 避免用完整标题搜索时 DanDanPlay 返回空结果
 */
export async function getAnimeById(apiPrefix: string, animeId: number, options?: { signal?: AbortSignal }): Promise<AnimeInfo | null> {
    const url = `${apiPrefix}/api/v2/bangumi/${animeId}`;
    logger.debug('dandanplay', `Fetching anime by id: ${animeId}`);

    const response = await get<BangumiResponse>(url, {
        timeout: 10000,
        retries: 2,
        signal: options?.signal,
    });

    const anime = response.bangumi;
    if (!anime?.episodes?.length) {
        logger.warn('dandanplay', `No episodes for anime ${animeId}`);
        return null;
    }

    logger.info('dandanplay', `Found ${anime.episodes.length} episodes for anime ${animeId}`);
    return anime;
}

/**
 * 获取弹幕评论
 */
export async function getComments(
    apiPrefix: string,
    episodeId: number,
    config: { chConvert: ChConvertMode; withRelated?: boolean },
    options?: { signal?: AbortSignal },
): Promise<DanDanPlayComment[]> {
    const { chConvert, withRelated = true } = config;
    const url = `${apiPrefix}/api/v2/comment/${episodeId}?withRelated=${withRelated}&chConvert=${chConvert}`;

    logger.debug('dandanplay', `Fetching comments for episode ${episodeId}`);

    const response = await get<{ comments: DanDanPlayComment[] }>(url, {
        timeout: 15000,
        retries: 2,
        signal: options?.signal,
    });

    const comments = response.comments || [];
    logger.info('dandanplay', `Fetched ${comments.length} comments for episode ${episodeId}`);

    return comments;
}

/**
 * 获取关联弹幕源
 */
export async function getRelatedSources(apiPrefix: string, episodeId: number, options?: { signal?: AbortSignal }): Promise<RelatedSource[]> {
    const url = `${apiPrefix}/api/v2/related/${episodeId}`;
    logger.debug('dandanplay', `Fetching related sources for episode ${episodeId}`);

    const response = await get<{ relateds: RelatedSource[] }>(url, {
        timeout: 10000,
        retries: 2,
        signal: options?.signal,
    });

    const sources = response.relateds || [];
    logger.info('dandanplay', `Found ${sources.length} related sources for episode ${episodeId}`);

    return sources;
}

/**
 * 获取外部弹幕源评论
 */
export async function getExtComments(apiPrefix: string, sourceUrl: string, config: { chConvert: ChConvertMode }, options?: { signal?: AbortSignal }): Promise<DanDanPlayComment[]> {
    const { chConvert } = config;
    const url = `${apiPrefix}/api/v2/extcomment?chConvert=${chConvert}&url=${encodeURIComponent(sourceUrl)}`;

    logger.debug('dandanplay', `Fetching ext comments from ${sourceUrl}`);

    const response = await get<{ comments: DanDanPlayComment[] }>(url, {
        timeout: 15000,
        retries: 1, // 外部源只重试一次
        signal: options?.signal,
    });

    const comments = response.comments || [];
    logger.info('dandanplay', `Fetched ${comments.length} ext comments from ${sourceUrl}`);

    return comments;
}

/**
 * 发送弹幕
 */
export async function postComment(
    apiPrefix: string,
    episodeId: number,
    comment: { text: string; time: number; mode: number; color: number },
    token: string,
    options?: { signal?: AbortSignal },
): Promise<void> {
    const url = `${apiPrefix}/api/v2/comment/${episodeId}`;

    logger.debug('dandanplay', `Posting comment to episode ${episodeId}`);

    await post(
        url,
        {
            time: comment.time,
            mode: comment.mode,
            color: comment.color,
            comment: comment.text,
        },
        {
            headers: {
                Authorization: `Bearer ${token}`,
            },
            timeout: 10000,
            retries: 1,
            signal: options?.signal,
        },
    );

    logger.info('dandanplay', 'Comment posted successfully');
}

/**
 * 提交关联弹幕源
 */
export async function postRelatedSource(apiPrefix: string, episodeId: number, url: string, token: string, options?: { signal?: AbortSignal }): Promise<void> {
    const apiUrl = `${apiPrefix}/api/v2/related/${episodeId}`;

    logger.debug('dandanplay', `Posting related source: ${url}`);

    await post(
        apiUrl,
        { episodeId, url, shift: 0 },
        {
            headers: {
                Authorization: `Bearer ${token}`,
            },
            timeout: 10000,
            retries: 1,
            signal: options?.signal,
        },
    );

    logger.info('dandanplay', 'Related source posted successfully');
}

/**
 * 转换 DanDanPlay 评论格式为内部格式
 */
export function convertDanDanPlayComment(comment: DanDanPlayComment): RawComment {
    const parts = comment.p.split(',');
    return {
        time: parseFloat(parts[0] ?? '0'),
        modeId: parseInt(parts[1] ?? '1', 10),
        color: parseInt(parts[2] ?? '16777215', 10),
        text: comment.m,
        user: parts[3] || undefined,
    };
}
