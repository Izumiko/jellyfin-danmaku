import { similarityPercentage } from '../danmaku/similarity';
import type { AnimeInfo } from '../types/index';

/** 从分集标题抽取集号：兼容「第4话」「第 4 集」「S02E04」以及第三方 API 常见的裸数字「4」「4. 标题」 */
export function extractEpisodeNumber(title: string | undefined): number | null {
    const text = String(title ?? '');
    let match = text.match(/第\s*(\d+)\s*[话話集]/);
    if (match) return parseInt(match[1], 10);
    match = text.match(/[Ss]\d+\s*[Ee](\d+)/);
    if (match) return parseInt(match[1], 10);
    match = text.trim().match(/^(\d+)(?:\s|$|[.、:：-])/);
    if (match) return parseInt(match[1], 10);
    return null;
}

/** 去掉空白、括注和标点，便于比较标题 */
export function normalizeTitle(text: string): string {
    return String(text || '')
        .toLowerCase()
        .replace(/[\s\u3000]+/g, '')
        .replace(/[（(【[][^）)】\]]*[）)】\]]/g, '')
        .replace(/[!-/:-@[-`{-~！-／：-＠［-｀｛-～、-〜“”‘’·…—－_.]/g, '');
}

const CN_DIGITS: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

/** 从标题猜季数：第二季 / Season 2 / S2 / 2nd Season；allowTrailingDigit 时也认「标题2」 */
export function seasonHint(text: string, allowTrailingDigit = false): number | null {
    const t = String(text || '');
    let match = t.match(/第\s*([一二三四五六七八九十\d]+)\s*[季期部]/);
    if (match) return CN_DIGITS[match[1]] ?? (parseInt(match[1], 10) || null);
    match = t.match(/(?:season|\bs)\s*(\d+)/i);
    if (match) return parseInt(match[1], 10);
    match = t.match(/(\d+)\s*(?:nd|rd|th|st)\s*season/i);
    if (match) return parseInt(match[1], 10);
    if (allowTrailingDigit) {
        match = t.trim().match(/(\d+)$/);
        if (match) return parseInt(match[1], 10);
    }
    return null;
}

/** 标题相似度打分：编辑距离为基础，前缀/包含加分，季数一致加分、不一致或缺失扣分 */
export function titleMatchScore(query: string, candidate: string): number {
    const a = normalizeTitle(query);
    const b = normalizeTitle(candidate);
    if (!a || !b) return 0;

    let score = similarityPercentage(a, b);
    if (a === b) score += 100;
    else if (b.startsWith(a) || a.startsWith(b)) score += 40;
    else if (b.includes(a) || a.includes(b)) score += 20;

    const wanted = seasonHint(query, true);
    if (wanted !== null) {
        const got = seasonHint(candidate);
        if (got === wanted) score += 60;
        else if (got !== null) score -= 60;
        // 点名了第几季，但候选完全没写季数：多半是别季的作品
        else score -= 40;
    }
    return score;
}

/** 从搜索结果中挑出最像当前番剧的一项（第三方 API 的结果顺序不稳定，上游 issue #94） */
export function pickBestAnime(animes: AnimeInfo[], query: string): { index: number; score: number } {
    let index = 0;
    let best = -Infinity;
    animes.forEach((anime, i) => {
        const score = titleMatchScore(query, anime.animeTitle);
        if (score > best) {
            best = score;
            index = i;
        }
    });
    return { index, score: best };
}
