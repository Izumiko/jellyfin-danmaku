/**
 * 资源清理收集器
 *
 * 收集多个清理函数，统一执行。
 * 用于管理 Observer、Listener、Interval 等资源。
 */
export class DisposableStore {
    private disposables: (() => void)[] = [];

    /**
     * 添加清理函数
     */
    add(dispose: () => void): void {
        this.disposables.push(dispose);
    }

    /**
     * 添加 addEventListener 并自动返回 removeEventListener
     */
    addEventListener(
        target: EventTarget,
        event: string,
        handler: EventListener,
        options?: AddEventListenerOptions,
    ): void {
        target.addEventListener(event, handler, options);
        this.disposables.push(() => target.removeEventListener(event, handler, options));
    }

    /**
     * 添加 setInterval 并自动返回 clearInterval
     */
    addInterval(handler: () => void, interval: number): void {
        const id = setInterval(handler, interval);
        this.disposables.push(() => clearInterval(id));
    }

    /**
     * 添加 setTimeout 并自动返回 clearTimeout
     */
    addTimeout(handler: () => void, timeout: number): void {
        const id = setTimeout(handler, timeout);
        this.disposables.push(() => clearTimeout(id));
    }

    /**
     * 执行所有清理函数
     */
    dispose(): void {
        this.disposables.forEach((fn) => {
            try {
                fn();
            } catch (error) {
                console.error('[DisposableStore] Error during disposal:', error);
            }
        });
        this.disposables = [];
    }

    /**
     * 获取当前收集的清理函数数量
     */
    get size(): number {
        return this.disposables.length;
    }
}
