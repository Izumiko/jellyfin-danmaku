/**
 * 整数颜色值转 #rrggbb 十六进制字符串
 */
export function intToHex(color: number): string {
    return `#${color.toString(16).padStart(6, '0')}`;
}

/**
 * 判断颜色是否接近黑色（用于设置描边颜色）
 * 黑色文字用白色描边，其他颜色用黑色描边
 */
export function isDarkColor(color: number): boolean {
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;

    // 使用亮度公式判断
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness < 128;
}
