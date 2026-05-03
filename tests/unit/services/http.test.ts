import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { request, get, post } from '@/services/http';
import { DanmakuError, ErrorCode } from '@/types/index';

describe('http', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('request', () => {
        it('should make successful GET request', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    headers: new Headers({ 'content-type': 'application/json' }),
                    json: () => Promise.resolve({ data: 'test' }),
                } as Response),
            );

            const result = await request<{ data: string }>('https://example.com/api');
            expect(result).toEqual({ data: 'test' });
        });

        it('should make successful POST request', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    headers: new Headers({ 'content-type': 'application/json' }),
                    json: () => Promise.resolve({ success: true }),
                } as Response),
            );

            const result = await post<{ success: boolean }>('https://example.com/api', { key: 'value' });
            expect(result).toEqual({ success: true });
            expect(fetch).toHaveBeenCalledWith(
                'https://example.com/api',
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({ key: 'value' }),
                }),
            );
        });

        it('should retry on network error', async () => {
            global.fetch = vi
                .fn()
                .mockRejectedValueOnce(new Error('Network error'))
                .mockResolvedValueOnce({
                    ok: true,
                    headers: new Headers({ 'content-type': 'application/json' }),
                    json: () => Promise.resolve({ data: 'test' }),
                } as Response);

            const result = await request<{ data: string }>('https://example.com/api', { retries: 1, retryDelay: 10 });
            expect(result).toEqual({ data: 'test' });
            expect(fetch).toHaveBeenCalledTimes(2);
        });

        it('should throw DanmakuError on HTTP error', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: false,
                    status: 404,
                    text: () => Promise.resolve('Not found'),
                } as Response),
            );

            await expect(request('https://example.com/api')).rejects.toThrow(DanmakuError);
        });

        it('should throw timeout error', async () => {
            global.fetch = vi.fn(() =>
                new Promise((_, reject) =>
                    setTimeout(() => {
                        const error = new Error('Timeout');
                        error.name = 'AbortError';
                        reject(error);
                    }, 100)
                )
            );

            await expect(
                request('https://example.com/api', { timeout: 10, retries: 0 }),
            ).rejects.toThrow('timeout');
        });

        it('should handle abort signal', async () => {
            global.fetch = vi.fn(() =>
                new Promise((_, reject) => {
                    setTimeout(() => {
                        const error = new Error('Aborted');
                        error.name = 'AbortError';
                        reject(error);
                    }, 100);
                }),
            );

            const controller = new AbortController();
            controller.abort();

            await expect(
                request('https://example.com/api', { signal: controller.signal }),
            ).rejects.toThrow('cancelled');
        });
    });

    describe('get', () => {
        it('should make GET request with default options', async () => {
            global.fetch = vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    headers: new Headers({ 'content-type': 'application/json' }),
                    json: () => Promise.resolve({ data: 'test' }),
                } as Response),
            );

            await get<{ data: string }>('https://example.com/api');
            expect(fetch).toHaveBeenCalledWith(
                'https://example.com/api',
                expect.objectContaining({ method: 'GET' }),
            );
        });
    });
});
