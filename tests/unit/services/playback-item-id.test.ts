import { describe, it, expect } from 'vitest';
import { itemIdFromPlaybackInfoUrl } from '@/services/jellyfin/interceptor';

describe('itemIdFromPlaybackInfoUrl', () => {
    it('extracts item id from PlaybackInfo path', () => {
        expect(itemIdFromPlaybackInfoUrl('https://jf.example/Items/abc-123/PlaybackInfo?userId=1')).toBe('abc-123');
    });

    it('returns null when url is not PlaybackInfo', () => {
        expect(itemIdFromPlaybackInfoUrl('https://jf.example/Items/abc-123')).toBeNull();
    });
});
