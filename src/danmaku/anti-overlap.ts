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
    const filteredRtl = filterOverlappedScroll(rtl, config, 'rtl');
    const filteredLtr = filterOverlappedScroll(ltr, config, 'ltr');
    const filteredTop = filterOverlappedFixed(top, config);
    const filteredBottom = filterOverlappedFixed(bottom, config);

    // 合并并重新排序
    return [...filteredRtl, ...filteredLtr, ...filteredTop, ...filteredBottom].sort((a, b) => a.time - b.time);
}

/**
 * 滚动弹幕防重叠
 */
export function filterOverlappedScroll(
    sorted: ProcessedComment[],
    config: AntiOverlapConfig,
    direction: 'rtl' | 'ltr',
): ProcessedComment[] {
    const { containerWidth, containerHeight, fontSize } = config;

    // 计算轨道数量
    const trackCount = Math.floor(containerHeight / (fontSize * 1.5));
    if (trackCount === 0) return [];

    // 每个轨道的释放时间
    const trackReleaseTimes = new Array(trackCount).fill(0);

    const result: ProcessedComment[] = [];

    for (const comment of sorted) {
        // 测量弹幕宽度
        const width = textMeasurer.measure(comment.text, comment.style.font);

        // 计算弹幕完全通过屏幕所需时间
        const totalDistance = containerWidth + width;
        const duration = totalDistance / config.speed;

        // 计算弹幕进入屏幕的时间
        const entryTime = comment.time;

        // 查找可用轨道
        let trackIndex = -1;
        for (let i = 0; i < trackCount; i++) {
            if (entryTime >= trackReleaseTimes[i]) {
                trackIndex = i;
                break;
            }
        }

        // 如果没有可用轨道，跳过这条弹幕
        if (trackIndex === -1) continue;

        // 更新轨道释放时间
        trackReleaseTimes[trackIndex] = entryTime + duration;

        result.push(comment);
    }

    return result;
}

/**
 * 固定弹幕防重叠
 */
export function filterOverlappedFixed(sorted: ProcessedComment[], config: AntiOverlapConfig): ProcessedComment[] {
    const { containerHeight, fontSize } = config;

    // 计算轨道数量
    const trackCount = Math.floor(containerHeight / (fontSize * 1.5));
    if (trackCount === 0) return [];

    // 每个轨道的释放时间
    const trackReleaseTimes = new Array(trackCount).fill(0);

    // 固定弹幕显示时长（秒）
    const displayDuration = 4;

    const result: ProcessedComment[] = [];

    for (const comment of sorted) {
        const entryTime = comment.time;

        // 查找可用轨道
        let trackIndex = -1;
        for (let i = 0; i < trackCount; i++) {
            if (entryTime >= trackReleaseTimes[i]) {
                trackIndex = i;
                break;
            }
        }

        // 如果没有可用轨道，跳过这条弹幕
        if (trackIndex === -1) continue;

        // 更新轨道释放时间
        trackReleaseTimes[trackIndex] = entryTime + displayDuration;

        result.push(comment);
    }

    return result;
}
