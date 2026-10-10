import { intToHex } from '../utils/color';
import { applyBlockRules, stripLikeSuffix } from './shield';
import { mergeSimilarComments } from './merge';
import { DensityLimit } from '../types/index';
import type { RawComment, ProcessedComment, ProcessingConfig, SourceFilter, SourceStats, ModeFilter } from '../types/index';

export type CommentSource = keyof SourceFilter;

/**
 * 按发送者前缀判断来源。大小写不敏感：弹弹Play 写 [BiliBili]/[Gamer]，
 * 御坂网络等第三方 API 写 [bilibili]/[gamer]。
 */
export function classifySource(user: string | undefined): CommentSource {
    const lower = (user ?? '').toLowerCase();
    if (lower.startsWith('[bilibili]')) return 'bilibili';
    if (lower.startsWith('[gamer]')) return 'gamer';
    if (lower.startsWith('[')) return 'other';
    return 'dandanplay';
}

export function sourceStats(comments: RawComment[]): SourceStats {
    const stats: SourceStats = { total: comments.length, bilibili: 0, gamer: 0, dandanplay: 0, other: 0 };
    for (const comment of comments) stats[classifySource(comment.user)]++;
    return stats;
}

/**
 * 弹幕预处理管线
 *
 * 步骤：
 * 0. 正文清理（去点赞数）+ 屏蔽规则（关键词/正则/发送者/颜色）
 * 1. 去重（基于 time+mode+color+text 的 Map 去重）
 * 2. 来源过滤（bilibili/gamer/dandanplay/other）
 * 3. 模式过滤（scroll/top/bottom）
 * 4. 密度限制（基于时间窗口的桶限流）
 * 5. 格式转换（DanDanPlay mode ID → 引擎 mode 字符串，颜色整数 → 十六进制）+ 时间偏移
 * 6. 相似弹幕合并
 */
export function preProcessDanmaku(comments: RawComment[], config: ProcessingConfig): ProcessedComment[] {
    return preProcessWithReport(comments, config).comments;
}

/** 同 preProcessDanmaku，额外返回被屏蔽规则过滤掉的条数 */
export function preProcessWithReport(comments: RawComment[], config: ProcessingConfig): { comments: ProcessedComment[]; blocked: number } {
    // 0. 正文清理与屏蔽
    let processed = config.stripLikeSuffix ? comments.map((c) => ({ ...c, text: stripLikeSuffix(c.text) })) : comments;
    let blocked = 0;
    if (config.blockRules) {
        const result = applyBlockRules(processed, config.blockRules);
        processed = result.comments;
        blocked = result.blocked;
    }

    // 1. 去重
    processed = deduplicateComments(processed);

    // 2. 来源过滤
    processed = filterBySource(processed, config.sourceFilter);

    // 3. 模式过滤
    processed = filterByMode(processed, config.modeFilter);

    // 4. 密度限制
    if (config.densityLimit > 0) {
        const duration = Math.ceil(config.containerWidth / config.speed);
        const lines = Math.max(1, Math.floor((config.containerHeight - 18) / config.fontSize) - 1);
        processed = limitDensity(processed, config.densityLimit, duration, lines);
    }

    // 5. 格式转换
    let formatted = processed.map((comment) =>
        formatComment(comment, {
            fontSize: config.fontSize,
            fontFamily: config.fontFamily,
            fontOptions: config.fontOptions,
            timeOffset: config.timeOffset,
        }),
    );

    // 6. 相似弹幕合并
    if (config.mergeSimilar) {
        formatted = mergeSimilarComments(formatted, config.mergeThreshold ?? 85);
    }

    return { comments: formatted, blocked };
}

/**
 * 去重：基于内容的 Map 去重
 */
export function deduplicateComments(comments: RawComment[]): RawComment[] {
    const map = new Map<string, RawComment>();

    for (const comment of comments) {
        // 使用 time+mode+color+text 作为唯一键（不包含 user）
        const key = `${comment.time},${comment.modeId},${comment.color},${comment.text}`;
        if (!map.has(key)) {
            map.set(key, comment);
        }
    }

    return Array.from(map.values());
}

/**
 * 来源过滤
 */
export function filterBySource(comments: RawComment[], filter: SourceFilter): RawComment[] {
    // [BiliBili]/[bilibili] → B站，[Gamer]/[gamer] → 巴哈，其他 [...] → 第三方，无前缀 → 弹弹Play
    return comments.filter((comment) => filter[classifySource(comment.user)]);
}

/**
 * 模式过滤
 */
export function filterByMode(comments: RawComment[], filter: ModeFilter): RawComment[] {
    return comments.filter((comment) => {
        // DanDanPlay mode ID: 1=rtl, 4=bottom, 5=top, 6=ltr
        switch (comment.modeId) {
            case 1: // rtl (scroll)
            case 6: // ltr (scroll)
                return filter.scroll;
            case 5: // top
                return filter.top;
            case 4: // bottom
                return filter.bottom;
            default:
                // ede.js 只渲染 1/4/5/6 四种模式，其余（逆向、高级、代码弹幕等）一律丢弃
                return false;
        }
    });
}

/**
 * 密度限制
 */
export function limitDensity(
    comments: RawComment[],
    limit: DensityLimit,
    bucketSize: number,
    lines = 1,
): RawComment[] {
    if (limit === DensityLimit.Unlimited) return comments;

    const scrollLimit = (9 - limit * 2) * lines;
    const verticalLimit = lines - 1 > 0 ? lines - 1 : 1;
    const scrollBuckets = new Map<number, number>();
    const verticalBuckets = new Map<number, number>();
    const result: RawComment[] = [];

    // ede.js 按原始顺序处理，不重排弹幕。
    for (const comment of comments) {
        const timeIndex = Math.ceil(comment.time / Math.max(bucketSize, Number.EPSILON));
        const isVertical = comment.modeId === 4 || comment.modeId === 5;

        if (isVertical) {
            const count = (verticalBuckets.get(timeIndex) ?? 0) + 1;
            verticalBuckets.set(timeIndex, count);
            if (count > verticalLimit) continue;
        } else {
            const count = (scrollBuckets.get(timeIndex) ?? 0) + 1;
            scrollBuckets.set(timeIndex, count);
            if (count > scrollLimit) continue;
        }

        result.push(comment);
    }

    return result;
}

/**
 * 格式转换
 */
export function formatComment(comment: RawComment, style: { fontSize: number; fontFamily: string; fontOptions: string; timeOffset: number }): ProcessedComment {
    // DanDanPlay mode ID 转换为引擎 mode
    const modeMap: Record<number, ProcessedComment['mode']> = {
        1: 'rtl',
        4: 'bottom',
        5: 'top',
        6: 'ltr',
    };

    const mode = modeMap[comment.modeId] || 'rtl';
    const fillStyle = intToHex(comment.color);
    const strokeStyle = comment.color === 0 ? '#fff' : '#000';

    return {
        text: comment.text,
        mode,
        time: comment.time + style.timeOffset,
        style: {
            font: `${style.fontOptions} ${style.fontSize}px ${style.fontFamily}`.trim(),
            fillStyle,
            strokeStyle,
            lineWidth: 2.0,
        },
    };
}
