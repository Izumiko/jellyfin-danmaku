import { DanmakuError, ErrorCode, type RequestOptions } from '../types/index';
import { logger } from '../core/logger';

/**
 * 统一 HTTP 请求函数
 *
 * 特性：
 * - AbortController 超时控制
 * - 指数退避重试（可配置次数）
 * - 外部 AbortSignal 支持（用于取消）
 * - 结构化错误（NetworkError / HttpError / ParseError）
 */
export async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', headers = {}, body, timeout = 10000, retries = 2, retryDelay = 1000, signal: externalSignal } = options;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
        // 创建 AbortController 用于超时控制
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        // 合并外部信号和超时信号，并在本次请求结束后移除监听器。
        const combined = externalSignal
            ? createCombinedSignal(externalSignal, controller.signal)
            : { signal: controller.signal, cleanup: () => {} };
        const combinedSignal = combined.signal;

        try {
            logger.debug('http', `Request ${method} ${url} (attempt ${attempt + 1}/${retries + 1})`);

            const response = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    ...headers,
                },
                body,
                signal: combinedSignal,
            });

            // HTTP 错误处理
            if (!response.ok) {
                const errorText = await response.text().catch(() => 'Unknown error');
                throw new DanmakuError(`HTTP ${response.status}: ${errorText}`, ErrorCode.HttpError, { status: response.status, url });
            }

            // 解析响应
            const contentType = response.headers.get('content-type');
            if (contentType?.includes('application/json')) {
                const data = await response.json();
                logger.debug('http', `Response from ${url}`, { dataSize: JSON.stringify(data).length });
                return data as T;
            } else {
                const text = await response.text();
                logger.debug('http', `Response from ${url}`, { textSize: text.length });
                return text as T;
            }
        } catch (error) {
            // 处理取消
            if (error instanceof Error && error.name === 'AbortError') {
                if (externalSignal?.aborted) {
                    throw new DanmakuError('Request cancelled', ErrorCode.Cancelled, error);
                } else {
                    throw new DanmakuError(`Request timeout after ${timeout}ms`, ErrorCode.Timeout, error);
                }
            }

            // 处理 DanmakuError（不重试）
            if (error instanceof DanmakuError) {
                throw error;
            }

            // 网络错误
            lastError = error instanceof Error ? error : new Error(String(error));

            // 如果还有重试次数，等待后重试
            if (attempt < retries) {
                const delay = retryDelay * Math.pow(2, attempt); // 指数退避
                logger.warn('http', `Request failed, retrying in ${delay}ms`, { error: lastError.message, attempt });
                await sleep(delay);
                continue;
            }
        } finally {
            clearTimeout(timeoutId);
            combined.cleanup();
        }
    }

    // 所有重试都失败
    throw new DanmakuError(`Request failed after ${retries + 1} attempts: ${lastError?.message}`, ErrorCode.Network, lastError);
}

/**
 * 创建组合的 AbortSignal
 */
function createCombinedSignal(
    signal1: AbortSignal,
    signal2: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
    const controller = new AbortController();

    const abort = () => controller.abort();

    signal1.addEventListener('abort', abort);
    signal2.addEventListener('abort', abort);

    // addEventListener 不会补发已经发生过的 abort。
    if (signal1.aborted || signal2.aborted) {
        controller.abort();
    }

    return {
        signal: controller.signal,
        cleanup: () => {
            signal1.removeEventListener('abort', abort);
            signal2.removeEventListener('abort', abort);
        },
    };
}

/**
 * Sleep 工具函数
 */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * GET 请求便捷方法
 */
export async function get<T>(url: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> {
    return request<T>(url, { ...options, method: 'GET' });
}

/**
 * POST 请求便捷方法
 */
export async function post<T>(url: string, data?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> {
    return request<T>(url, {
        ...options,
        method: 'POST',
        body: data ? JSON.stringify(data) : undefined,
    });
}
