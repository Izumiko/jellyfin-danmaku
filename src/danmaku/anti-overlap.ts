import { textMeasurer } from './text-measure';
import type { ProcessedComment, AntiOverlapConfig } from '../types/index';

/**
 * 防重叠过滤
 *
 * 将弹幕按模式分类，分别在轨道系统中进行碰撞检测：
 * - 滚动弹幕（rtl/ltr）：计算每条弹幕实际速度和轨道占用时间
 * - 固定弹幕（top/bottom）：按固定显示时长分配轨道
 *
 * @returns 过滤后的弹幕数组（移除了会重叠的弹幕）
 */
export function antiOverlapFilter(comments: ProcessedComment[], config: AntiOverlapConfig): ProcessedComment[] {
    // 按时间排序
    const sorted = [...comments].sort((a, b) => a.time - b.time);

    // 按模式分类
    const rtl = sorted.filter((c) => c.mode === 'rtl');
    const ltr = sorted.filter((c) => c.mode === 'ltr');
    const top = sorted.filter((c) => c.mode === 'top');
    const bottom = sorted.filter((c) => c.mode === 'bottom');

    // 分别过滤
    const filteredRtl = filterOverlappedScroll(rtl, config);
    const filteredLtr = filterOverlappedScroll(ltr, config);
    const filteredTop = filterOverlappedFixed(top, config);
    const filteredBottom = filterOverlappedFixed(bottom, config);

    // 合并并重新排序
    return [...filteredRtl, ...filteredLtr, ...filteredTop, ...filteredBottom].sort((a, b) => a.time - b.time);
}

/**
 * 滚动弹幕防重叠
 */
export function filterOverlappedScroll(sorted: ProcessedComment[], config: AntiOverlapConfig): ProcessedComment[] {
    const { containerWidth, containerHeight, fontSize, speed } = config;

    if (!sorted.length) return [];

    const trackCount = Math.floor((containerHeight - 18) / fontSize) - 1;
    if (trackCount <= 0) return [];

    const duration = Math.ceil(containerWidth / speed);
    const trackReleaseTimes = new Array(trackCount).fill(0);
    const result: ProcessedComment[] = [];

    for (const comment of sorted) {
        const width = textMeasurer.measure(comment.text, comment.style.font);
        const actualSpeed = (containerWidth + width) / duration;
        const timeToEnter = width / actualSpeed;

        for (let i = 0; i < trackReleaseTimes.length; i++) {
            if (comment.time >= trackReleaseTimes[i]) {
                result.push(comment);
                trackReleaseTimes[i] = comment.time + timeToEnter;
                break;
            }
        }
    }

    return result;
}

/**
 * 固定弹幕防重叠
 */
export function filterOverlappedFixed(sorted: ProcessedComment[], config: AntiOverlapConfig): ProcessedComment[] {
    const { containerWidth, containerHeight, fontSize, speed } = config;

    const trackCount = Math.floor((containerHeight - 18) / fontSize) - 1;
    if (!sorted.length || trackCount <= 0) return [];

    const duration = Math.ceil(containerWidth / speed);
    const trackReleaseTimes = new Array(trackCount).fill(0);
    const result: ProcessedComment[] = [];

    for (const comment of sorted) {
        for (let i = 0; i < trackReleaseTimes.length; i++) {
            if (comment.time >= trackReleaseTimes[i]) {
                result.push(comment);
                trackReleaseTimes[i] = comment.time + duration;
                break;
            }
        }
    }

    return result;
}
