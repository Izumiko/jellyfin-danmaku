import { intToHex, isDarkColor } from '../utils/color';
import { DensityLimit } from '../types/index';
import type { RawComment, ProcessedComment, ProcessingConfig, SourceFilter, ModeFilter } from '../types/index';

/**
 * 弹幕预处理管线
 *
 * 步骤：
 * 1. 去重（基于 time+mode+color+text 的 Map 去重）
 * 2. 来源过滤（bilibili/gamer/dandanplay/other）
 * 3. 模式过滤（scroll/top/bottom）
 * 4. 密度限制（基于时间窗口的桶限流）
 * 5. 格式转换（DanDanPlay mode ID → 引擎 mode 字符串，颜色整数 → 十六进制）
 * 6. 时间偏移
 */
export function preProcessDanmaku(comments: RawComment[], config: ProcessingConfig): ProcessedComment[] {
    // 1. 去重
    let processed = deduplicateComments(comments);

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
    return processed.map((comment) =>
        formatComment(comment, {
            fontSize: config.fontSize,
            fontFamily: config.fontFamily,
            fontOptions: config.fontOptions,
            timeOffset: config.timeOffset,
        }),
    );
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
    return comments.filter((comment) => {
        if (!comment.user) return filter.other;

        const user = comment.user.toLowerCase();

        if (user.includes('bilibili')) return filter.bilibili;
        if (user.includes('gamer') || user.includes('bahamut')) return filter.gamer;
        if (user.includes('dandanplay')) return filter.dandanplay;

        return filter.other;
    });
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
                return true;
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

    // 与 ede.js 保持一致：等级越高限制越严格。
    // 滚动弹幕每个 duration 时间桶最多 (9 - level * 2) * lines 条；
    // 顶部/底部弹幕分别最多 lines - 1 条（至少 1 条）。
    const scrollLimit = Math.max(1, (9 - limit * 2) * Math.max(1, lines));
    const fixedLimit = Math.max(1, lines - 1);

    const sorted = [...comments].sort((a, b) => a.time - b.time);
    const scrollBuckets = new Map<number, number>();
    const topBuckets = new Map<number, number>();
    const bottomBuckets = new Map<number, number>();
    const result: RawComment[] = [];

    for (const comment of sorted) {
        const bucketIndex = Math.floor(comment.time / Math.max(bucketSize, Number.EPSILON));

        if (comment.modeId === 1 || comment.modeId === 6) {
            const count = scrollBuckets.get(bucketIndex) ?? 0;
            if (count >= scrollLimit) continue;
            scrollBuckets.set(bucketIndex, count + 1);
            result.push(comment);
            continue;
        }

        if (comment.modeId === 5) {
            const count = topBuckets.get(bucketIndex) ?? 0;
            if (count >= fixedLimit) continue;
            topBuckets.set(bucketIndex, count + 1);
            result.push(comment);
            continue;
        }

        if (comment.modeId === 4) {
            const count = bottomBuckets.get(bucketIndex) ?? 0;
            if (count >= fixedLimit) continue;
            bottomBuckets.set(bucketIndex, count + 1);
            result.push(comment);
            continue;
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
    const strokeStyle = isDarkColor(comment.color) ? '#fff' : '#000';

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
