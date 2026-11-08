/**
 * 整数颜色值转 #rrggbb 十六进制字符串
 */
export function intToHex(color: number): string {
    const normalized = Number.isFinite(color) ? Math.max(0, Math.min(0xffffff, Math.trunc(color))) : 0xffffff;
    return `#${normalized.toString(16).padStart(6, '0')}`;
}
