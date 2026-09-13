/**
 * 等待 DOM 元素出现
 *
 * @param selector - CSS 选择器
 * @param options.timeout - 超时时间（ms），默认 10000
 * @param options.signal - 外部取消信号
 * @returns Promise<HTMLElement>，超时则 reject
 */
export function waitForElement(selector: string, options?: { timeout?: number; signal?: AbortSignal }): Promise<HTMLElement> {
    const timeout = options?.timeout ?? 10000;
    const signal = options?.signal;

    return new Promise((resolve, reject) => {
        // 检查是否已存在
        const existing = document.querySelector(selector);
        if (existing instanceof HTMLElement) {
            resolve(existing);
            return;
        }

        // 检查是否已取消
        if (signal?.aborted) {
            reject(new Error('Aborted'));
            return;
        }

        // 超时处理
        const timeoutId = window.setTimeout(() => {
            cleanup();
            reject(new Error(`Timeout waiting for element: ${selector}`));
        }, timeout);

        // MutationObserver 监听 DOM 变化
        const observer = new MutationObserver(() => {
            const element = document.querySelector(selector);
            if (element instanceof HTMLElement) {
                cleanup();
                resolve(element);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });

        // 外部取消信号
        signal?.addEventListener('abort', onAbort);

        function cleanup() {
            clearTimeout(timeoutId);
            observer.disconnect();
            signal?.removeEventListener('abort', onAbort);
        }

        function onAbort() {
            cleanup();
            reject(new Error('Aborted'));
        }
    });
}

/**
 * debounce
 * @returns 带 cancel() 方法的 debounced 函数
 */
export function debounce<T extends (...args: unknown[]) => void>(fn: T, delay: number): T & { cancel: () => void } {
    let timeoutId: number | undefined;

    const debounced = function (this: unknown, ...args: unknown[]) {
        if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
        }
        timeoutId = window.setTimeout(() => {
            fn.apply(this, args);
        }, delay);
    } as T & { cancel: () => void };

    debounced.cancel = () => {
        if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
            timeoutId = undefined;
        }
    };

    return debounced;
}

/**
 * throttle
 */
export function throttle<T extends (...args: unknown[]) => void>(fn: T, interval: number): T {
    let lastTime = 0;

    return function (this: unknown, ...args: unknown[]) {
        const now = Date.now();
        if (now - lastTime >= interval) {
            lastTime = now;
            fn.apply(this, args);
        }
    } as T;
}

/**
 * clamp - 将值限制在范围内
 */
export function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

/**
 * parseFloatOfRange - 解析浮点数并 clamp
 */
export function parseFloatOfRange(str: string, min: number, max: number): number {
    const value = parseFloat(str);
    if (isNaN(value)) return min;
    return clamp(value, min, max);
}

/** Insert `node` before `reference`, even if `reference` is nested under `container`. */
export function insertBeforeRef(container: Element, node: Node, reference: Element | null): void {
    if (reference?.parentNode) {
        reference.parentNode.insertBefore(node, reference);
        return;
    }
    const scroller = container.querySelector('.actionSheetScroller');
    (scroller ?? container).appendChild(node);
}
