import { describe, it, expect, vi, beforeEach } from 'vitest';
import { postComment, postRelatedSource } from '@/services/dandanplay/client';
import { post } from '@/services/http';

vi.mock('@/services/http', () => ({
    get: vi.fn(),
    post: vi.fn(),
}));

describe('dandanplay posts', () => {
    beforeEach(() => vi.clearAllMocks());

    it('posts comment with comment field not text', async () => {
        vi.mocked(post).mockResolvedValue(undefined);
        await postComment('https://api.example.com', 9, { text: 'hi', time: 1, mode: 1, color: 0 }, 'tok');
        expect(post).toHaveBeenCalledWith(
            'https://api.example.com/api/v2/comment/9',
            { time: 1, mode: 1, color: 0, comment: 'hi' },
            expect.objectContaining({ headers: { Authorization: 'Bearer tok' } }),
        );
    });

    it('posts related source with episodeId url shift', async () => {
        vi.mocked(post).mockResolvedValue(undefined);
        await postRelatedSource('https://api.example.com', 9, 'https://bilibili.com/x', 'tok');
        expect(post).toHaveBeenCalledWith(
            'https://api.example.com/api/v2/related/9',
            { episodeId: 9, url: 'https://bilibili.com/x', shift: 0 },
            expect.objectContaining({ headers: { Authorization: 'Bearer tok' } }),
        );
    });
});
