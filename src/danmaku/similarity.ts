/**
 * 基于编辑距离（Levenshtein）的相似度，0-100。
 * 使用两行滚动数组，空间 O(min(m, n))。
 */
export function similarityPercentage(a: string, b: string): number {
    if (a === b) return 100;
    if (!a || !b) return 0;
    if (a.length > b.length) [a, b] = [b, a];

    let previous = Array.from({ length: a.length + 1 }, (_, i) => i);
    let current = new Array<number>(a.length + 1);
    for (let j = 1; j <= b.length; j++) {
        current[0] = j;
        for (let i = 1; i <= a.length; i++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            current[i] = Math.min(previous[i - 1] + cost, previous[i] + 1, current[i - 1] + 1);
        }
        [previous, current] = [current, previous];
    }
    return Math.max(0, 100 - (previous[a.length] / b.length) * 100);
}

/**
 * 相似度的上界：编辑距离至少是长度差，所以相似度不可能超过 短/长。
 * 用来在计算编辑距离前剪枝。
 */
export function similarityUpperBound(a: string, b: string): number {
    const max = Math.max(a.length, b.length);
    return max === 0 ? 100 : (Math.min(a.length, b.length) / max) * 100;
}
