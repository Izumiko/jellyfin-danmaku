import { LogLevel, type LogEntry } from '../types/index';

class Logger {
    private entries: LogEntry[] = [];
    private maxEntries = 100;
    private enabled = false;

    /**
     * 设置日志是否启用
     */
    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }

    /**
     * 记录日志
     * 同时输出到 console 和内部存储（供 DebugOverlay 显示）
     */
    log(level: LogLevel, module: string, message: string, data?: unknown): void {
        const entry: LogEntry = {
            timestamp: Date.now(),
            level,
            module,
            message,
            data,
        };

        // 添加到内部存储
        this.entries.push(entry);
        if (this.entries.length > this.maxEntries) {
            this.entries.shift();
        }

        // 输出到 console
        if (this.enabled || level >= LogLevel.WARN) {
            const prefix = `[${module}]`;
            const logData = data !== undefined ? [prefix, message, data] : [prefix, message];

            switch (level) {
                case LogLevel.DEBUG:
                    console.debug(...logData);
                    break;
                case LogLevel.INFO:
                    console.info(...logData);
                    break;
                case LogLevel.WARN:
                    console.warn(...logData);
                    break;
                case LogLevel.ERROR:
                    console.error(...logData);
                    break;
            }
        }
    }

    /**
     * 获取最近日志（供 DebugOverlay 显示）
     */
    getRecent(count = 50): LogEntry[] {
        return this.entries.slice(-count);
    }

    /**
     * 清空日志
     */
    clear(): void {
        this.entries = [];
    }

    // 便捷方法
    debug(module: string, message: string, data?: unknown): void {
        this.log(LogLevel.DEBUG, module, message, data);
    }

    info(module: string, message: string, data?: unknown): void {
        this.log(LogLevel.INFO, module, message, data);
    }

    warn(module: string, message: string, data?: unknown): void {
        this.log(LogLevel.WARN, module, message, data);
    }

    error(module: string, message: string, data?: unknown): void {
        this.log(LogLevel.ERROR, module, message, data);
    }
}

export const logger = new Logger();
