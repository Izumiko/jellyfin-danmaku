type EventMap = {
    /** 请求重新加载弹幕 */
    'danmaku:reload': { reason: 'init' | 'search' | 'refresh' | 'settings-changed' };
    /** 弹幕加载完成 */
    'danmaku:loaded': { count: number; source: string };
    /** 弹幕加载失败 */
    'danmaku:error': { error: Error; source: string };
    /** 视频源变更 */
    'media:source-changed': undefined;
    /** 视频播放器被销毁 */
    'media:removed': undefined;
    /** 设置侧边栏打开请求 */
    'settings:open': undefined;
    /** 设置已保存 */
    'settings:saved': undefined;
    /** 增加弹幕源 */
    'danmaku:add-source': { url: string };
    /** 发送弹幕 */
    'danmaku:send': { text: string; mode: 1 | 4 | 5 | 6; color: number };
    /** 发送弹幕结果 */
    'danmaku:send-result': { success: boolean; message?: string };
    /** 弹弹play 登录 */
    'auth:login': { account: string; password: string };
    /** 弹弹play 登录结果 */
    'auth:login-result': { success: boolean };
    /** 弹弹play 登出 */
    'auth:logout': undefined;
};

class TypedEventBus {
    private listeners = new Map<string, Set<(data: unknown) => void>>();

    /**
     * 订阅事件
     * @returns 取消订阅函数（Disposable 模式）
     */
    on<K extends keyof EventMap>(event: K, handler: (data: EventMap[K]) => void): () => void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }

        const handlers = this.listeners.get(event)!;
        handlers.add(handler as (data: unknown) => void);

        // 返回取消订阅函数
        return () => {
            handlers.delete(handler as (data: unknown) => void);
            if (handlers.size === 0) {
                this.listeners.delete(event);
            }
        };
    }

    /**
     * 发送事件
     */
    emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
        const handlers = this.listeners.get(event);
        if (!handlers) return;

        handlers.forEach((handler) => {
            try {
                handler(data);
            } catch (error) {
                console.error(`[EventBus] Error in handler for event "${event}":`, error);
            }
        });
    }

    /**
     * 清除所有订阅
     */
    clear(): void {
        this.listeners.clear();
    }

    /**
     * 清除指定事件的所有订阅
     */
    clearEvent<K extends keyof EventMap>(event: K): void {
        this.listeners.delete(event);
    }
}

export const eventBus = new TypedEventBus();
