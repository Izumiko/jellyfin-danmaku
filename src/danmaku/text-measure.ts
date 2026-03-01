/**
 * 带 LRU 缓存的文字宽度测量
 *
 * 使用离屏 Canvas 2D Context 测量文字像素宽度。
 * LRU 缓存避免重复测量，同时限制最大条目数防止内存泄漏。
 */
export class TextMeasurer {
    private cache: Map<string, number>;
    private context: CanvasRenderingContext2D | null = null;
    private maxCacheSize: number;

    constructor(maxCacheSize = 2000) {
        this.cache = new Map();
        this.maxCacheSize = maxCacheSize;
    }

    /**
     * 懒初始化 Canvas Context（避免模块加载时创建 DOM）
     */
    private getContext(): CanvasRenderingContext2D {
        if (!this.context) {
            const canvas = document.createElement('canvas');
            this.context = canvas.getContext('2d')!;
        }
        return this.context;
    }

    /**
     * 测量文字宽度（带 LRU 缓存）
     */
    measure(text: string, font: string): number {
        const key = `${font}|${text}`;

        if (this.cache.has(key)) {
            // LRU: 移到末尾
            const value = this.cache.get(key)!;
            this.cache.delete(key);
            this.cache.set(key, value);
            return value;
        }

        const ctx = this.getContext();
        ctx.font = font;
        const width = ctx.measureText(text).width;

        // 淘汰最旧条目
        if (this.cache.size >= this.maxCacheSize) {
            const firstKey = this.cache.keys().next().value as string;
            if (firstKey) {
                this.cache.delete(firstKey);
            }
        }

        this.cache.set(key, width);
        return width;
    }

    /**
     * 清空缓存（切换剧集时调用）
     */
    clear(): void {
        this.cache.clear();
    }

    /**
     * 获取缓存大小
     */
    get cacheSize(): number {
        return this.cache.size;
    }
}

// 全局单例
export const textMeasurer = new TextMeasurer();
