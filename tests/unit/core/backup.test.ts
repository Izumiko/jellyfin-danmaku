import { describe, it, expect } from 'vitest';
import { exportSettings, parseSettingsBackup } from '@/core/backup';
import { DEFAULT_CONFIG } from '@/core/config';
import { buildMisakaPrefix, splitMisakaPrefix } from '@/services/misaka';

describe('settings backup', () => {
    it('round-trips its own export without the per-episode offset', () => {
        const json = exportSettings({ ...DEFAULT_CONFIG, speed: 320, blockKeywords: '剧透', curEpOffset: 5 });
        expect(JSON.parse(json).settings).not.toHaveProperty('curEpOffset');

        const restored = parseSettingsBackup(json);
        expect(restored.speed).toBe(320);
        expect(restored.blockKeywords).toBe('剧透');
        expect(restored).not.toHaveProperty('curEpOffset');
    });

    it('imports an ede.js v1.62 backup (localStorage keys with string values)', () => {
        const edeBackup = JSON.stringify({
            version: 2,
            app: 'jellyfin-danmaku-merged',
            settings: { danmakuspeed: '150', danmakuFilter: '1', danmakuBlockUsers: '[BiliBili]', danmakuMergeSimilar: '1', customApiPrefix: 'http://m:7768/api/v1/t' },
        });
        const restored = parseSettingsBackup(edeBackup);
        expect(restored.speed).toBe(150);
        expect(restored.sourceFilter.bilibili).toBe(false);
        expect(restored.blockUsers).toBe('[BiliBili]');
        expect(restored.mergeSimilar).toBe(true);
        expect(restored.customApiPrefix).toBe('http://m:7768/api/v1/t');
    });

    it('rejects unrelated JSON', () => {
        expect(() => parseSettingsBackup('{"foo":1}')).toThrow();
        expect(() => parseSettingsBackup('not json')).toThrow();
    });
});

describe('misaka prefix', () => {
    it('builds and splits the /api/v1/<token> prefix', () => {
        expect(buildMisakaPrefix('http://192.168.1.10:7768/', ' abc ')).toBe('http://192.168.1.10:7768/api/v1/abc');
        expect(buildMisakaPrefix('http://h:7768/api/v1/xyz', '')).toBe('http://h:7768/api/v1/xyz');
        expect(buildMisakaPrefix('http://h:7768', '')).toBe('');
        expect(splitMisakaPrefix('http://h:7768/api/v1/xyz')).toEqual({ base: 'http://h:7768', token: 'xyz' });
        expect(splitMisakaPrefix('https://api.dandanplay.net')).toBeNull();
    });
});
