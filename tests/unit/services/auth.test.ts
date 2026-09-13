import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DanDanPlayAuth } from '@/services/dandanplay/auth';
import { get, post } from '@/services/http';

vi.mock('@/services/http', () => ({
    get: vi.fn(),
    post: vi.fn(),
}));

describe('DanDanPlayAuth', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
    });

    it('rejects login when errorCode is not 0', async () => {
        vi.mocked(post).mockResolvedValue({
            errorCode: 1,
            errorMessage: 'bad password',
        });
        const auth = new DanDanPlayAuth('https://api.example.com');
        await expect(auth.login('a', 'b')).resolves.toBe(false);
        expect(auth.isLoggedIn).toBe(false);
    });

    it('stores tokenExpireTime from login', async () => {
        vi.mocked(post).mockResolvedValue({
            errorCode: 0,
            token: 't1',
            tokenExpireTime: '2099-01-01T00:00:00Z',
            userName: 'bob',
        });
        const auth = new DanDanPlayAuth('https://api.example.com');
        await expect(auth.login('a', 'b')).resolves.toBe(true);
        expect(auth.token).toBe('t1');
        expect(auth.isLoggedIn).toBe(true);
    });

    it('renews with GET /login/renew', async () => {
        const soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
        localStorage.setItem(
            'jellyfin_danmaku_ddplay_status',
            JSON.stringify({ isLogin: true, token: 'old', tokenExpire: Date.now() + 2 * 86400000 }),
        );
        vi.mocked(get).mockResolvedValue({
            errorCode: 0,
            token: 'new',
            tokenExpireTime: soon,
        });
        const auth = new DanDanPlayAuth('https://api.example.com');
        await auth.refreshIfNeeded();
        expect(get).toHaveBeenCalledWith(
            'https://api.example.com/api/v2/login/renew',
            expect.objectContaining({
                headers: { Authorization: 'Bearer old' },
            }),
        );
        expect(post).not.toHaveBeenCalled();
        expect(auth.token).toBe('new');
    });
});
