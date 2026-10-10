import { similarityPercentage, similarityUpperBound } from './similarity';
import type { ProcessedComment } from '../types/index';

/** 合并的时间窗（秒），与 ede.js 一致 */
export const MERGE_TIME_WINDOW = 2;

/**
 * 合并时间窗内、同一模式下相似度达到阈值的弹幕，保留最早一条并标注 [xN]。
 * 先用长度比剪枝，够不到阈值的组合不计算编辑距离（数万条时差异很大）。
 */
export function mergeSimilarComments(comments: ProcessedComment[], threshold: number, timeWindow = MERGE_TIME_WINDOW): ProcessedComment[] {
    if (comments.length < 2) return comments;

    const sorted = [...comments].sort((a, b) => a.time - b.time);
    const consumed = new Uint8Array(sorted.length);
    const merged: ProcessedComment[] = [];

    for (let i = 0; i < sorted.length; i++) {
        if (consumed[i]) continue;
        const base = sorted[i];
        let count = 1;

        for (let j = i + 1; j < sorted.length; j++) {
            const other = sorted[j];
            if (other.time - base.time > timeWindow) break;
            if (consumed[j] || other.mode !== base.mode) continue;
            if (other.text !== base.text && similarityUpperBound(base.text, other.text) < threshold) continue;
            if (similarityPercentage(base.text, other.text) >= threshold) {
                consumed[j] = 1;
                count++;
            }
        }

        merged.push(count > 1 ? { ...base, text: `${base.text} [x${count}]` } : base);
    }
    return merged;
}
