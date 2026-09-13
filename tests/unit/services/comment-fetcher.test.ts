import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommentFetcher } from '@/services/comment-fetcher';
import type { RawComment, SourceFilter, ChConvertMode } from '@/types/index';

// Mock dandanplay client
vi.mock('@/services/dandanplay/client', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/services/dandanplay/client')>();
    return {
        ...actual,
        getComments: vi.fn(),
        getRelatedSources: vi.fn(),
        getExtComments: vi.fn(),
    };
});

// Mock jellyfin danmaku
vi.mock('@/services/jellyfin/danmaku', () => ({
    getLocalXmlDanmaku: vi.fn(),
}));

import { getComments, getRelatedSources, getExtComments } from '@/services/dandanplay/client';
import { getLocalXmlDanmaku } from '@/services/jellyfin/danmaku';

describe('CommentFetcher', () => {
    let fetcher: CommentFetcher;

    const defaultDeps = {
        apiPrefix: 'https://api.example.com',
        chConvert: 0 as ChConvertMode,
        sourceFilter: {
            bilibili: true,
            gamer: true,
            dandanplay: true,
            other: true,
        } as SourceFilter,
        useXmlDanmaku: false,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        fetcher = new CommentFetcher(defaultDeps);
    });

    const createDanDanPlayComment = (time: number, text: string) => ({
        cid: 1,
        p: `${time},1,16777215,user1`,
        m: text,
    });

    describe('fetch', () => {
        it('should fetch online comments by default', async () => {
            vi.mocked(getComments).mockResolvedValue([
                createDanDanPlayComment(1.0, 'hello'),
                createDanDanPlayComment(2.0, 'world'),
            ]);
            vi.mocked(getRelatedSources).mockResolvedValue([]);

            const result = await fetcher.fetch(123, 'item-456');

            expect(result).toHaveLength(2);
            expect(getLocalXmlDanmaku).not.toHaveBeenCalled();
        });

        it('should use local XML when enabled and available', async () => {
            const localComments: RawComment[] = [
                { time: 1.0, modeId: 1, color: 16777215, text: 'local' },
            ];

            vi.mocked(getLocalXmlDanmaku).mockResolvedValue(localComments);

            const xmlFetcher = new CommentFetcher({ ...defaultDeps, useXmlDanmaku: true });
            const result = await xmlFetcher.fetch(123, 'item-456');

            expect(result).toEqual(localComments);
            expect(getComments).not.toHaveBeenCalled();
        });

        it('should fallback to online when local XML fails', async () => {
            vi.mocked(getLocalXmlDanmaku).mockRejectedValue(new Error('No XML'));
            vi.mocked(getComments).mockResolvedValue([
                createDanDanPlayComment(1.0, 'fallback'),
            ]);
            vi.mocked(getRelatedSources).mockResolvedValue([]);

            const xmlFetcher = new CommentFetcher({ ...defaultDeps, useXmlDanmaku: true });
            const result = await xmlFetcher.fetch(123, 'item-456');

            expect(result.length).toBeGreaterThan(0);
            expect(getComments).toHaveBeenCalled();
        });

        it('should fetch related sources', async () => {
            vi.mocked(getComments).mockResolvedValue([
                createDanDanPlayComment(1.0, 'main'),
            ]);
            vi.mocked(getRelatedSources).mockResolvedValue([
                { url: 'https://bilibili.com/video/test', shift: 0 },
            ]);
            vi.mocked(getExtComments).mockResolvedValue([
                createDanDanPlayComment(2.0, 'related'),
            ]);

            const result = await fetcher.fetch(123, 'item-456');

            expect(result.length).toBeGreaterThanOrEqual(2);
            expect(getExtComments).toHaveBeenCalled();
        });

        it('should filter related sources by url', async () => {
            vi.mocked(getComments).mockResolvedValue([]);
            vi.mocked(getRelatedSources).mockResolvedValue([
                { url: 'https://bilibili.com/video/test', shift: 0 },
                { url: 'https://gamer.com.tw/test', shift: 0 },
                { url: 'https://other.com/test', shift: 0 },
            ]);
            vi.mocked(getExtComments).mockResolvedValue([]);

            // Fetcher with bilibili disabled
            const filteredFetcher = new CommentFetcher({
                ...defaultDeps,
                sourceFilter: { bilibili: false, gamer: true, dandanplay: true, other: true },
            });

            await filteredFetcher.fetch(123, 'item-456');

            // Should not fetch bilibili source
            expect(getExtComments).not.toHaveBeenCalledWith(
                expect.anything(),
                'https://bilibili.com/video/test',
                expect.anything(),
            );
        });

        it('rethrows on total failure', async () => {
            vi.mocked(getComments).mockRejectedValue(new Error('Network error'));

            await expect(fetcher.fetch(123, 'item-456')).rejects.toThrow('Network error');
        });

        it('returns empty array when online fetch succeeds with no comments', async () => {
            vi.mocked(getComments).mockResolvedValue([]);
            vi.mocked(getRelatedSources).mockResolvedValue([]);

            const result = await fetcher.fetch(123, 'item-456');

            expect(result).toEqual([]);
        });

        it('applies related source shift to comment times', async () => {
            vi.mocked(getComments).mockResolvedValue([]);
            vi.mocked(getRelatedSources).mockResolvedValue([
                { url: 'https://other.com/a', shift: 5 },
            ]);
            vi.mocked(getExtComments).mockResolvedValue([
                { cid: 1, p: '1,1,16777215,u', m: 'shifted' },
            ]);
            const result = await fetcher.fetch(123, 'item-456');
            expect(result[0]?.time).toBe(6);
        });

        it('keeps main comments when one ext source fails', async () => {
            vi.mocked(getComments).mockResolvedValue([
                { cid: 1, p: '1,1,16777215,u', m: 'main' },
            ]);
            vi.mocked(getRelatedSources).mockResolvedValue([
                { url: 'https://other.com/bad', shift: 0 },
                { url: 'https://other.com/ok', shift: 0 },
            ]);
            vi.mocked(getExtComments)
                .mockRejectedValueOnce(new Error('fail'))
                .mockResolvedValueOnce([{ cid: 2, p: '2,1,16777215,u', m: 'ok' }]);
            const result = await fetcher.fetch(123, 'item-456');
            expect(result.map((c) => c.text).sort()).toEqual(['main', 'ok']);
        });
    });
});
