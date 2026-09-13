import { describe, it, expect, beforeEach } from 'vitest';
import { Storage } from '@/core/storage';
import { DEFAULT_CONFIG } from '@/core/config';
import type { DanmakuConfig } from '@/types/index';

describe('Storage', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    describe('loadConfig', () => {
        it('should return default config when localStorage is empty', () => {
            const config = Storage.loadConfig();
            expect(config).toEqual(DEFAULT_CONFIG);
        });

        it('should load valid config from localStorage', () => {
            const testConfig: DanmakuConfig = {
                ...DEFAULT_CONFIG,
                opacity: 0.5,
                speed: 300,
            };
            localStorage.setItem('jellyfin_danmaku_config', JSON.stringify(testConfig));

            const loaded = Storage.loadConfig();
            expect(loaded.opacity).toBe(0.5);
            expect(loaded.speed).toBe(300);
        });

        it('should merge partial config with defaults', () => {
            const partialConfig = { opacity: 0.8 };
            localStorage.setItem('jellyfin_danmaku_config', JSON.stringify(partialConfig));

            const loaded = Storage.loadConfig();
            expect(loaded.opacity).toBe(0.8);
            expect(loaded.speed).toBe(DEFAULT_CONFIG.speed);
        });

        it('should return default config on parse error', () => {
            localStorage.setItem('jellyfin_danmaku_config', 'invalid json');

            const loaded = Storage.loadConfig();
            expect(loaded).toEqual(DEFAULT_CONFIG);
        });
    });

    describe('saveConfig', () => {
        it('should save config to localStorage', () => {
            const testConfig: DanmakuConfig = {
                ...DEFAULT_CONFIG,
                fontSize: 24,
            };

            Storage.saveConfig(testConfig);

            const raw = localStorage.getItem('jellyfin_danmaku_config');
            expect(raw).toBeTruthy();
            const parsed = JSON.parse(raw!);
            expect(parsed.fontSize).toBe(24);
        });
    });

    describe('episode cache', () => {
        it('should store and retrieve episode cache', () => {
            const cache = {
                episodeId: 12345,
                animeTitle: 'Test Anime',
                episodeTitle: 'Episode 1',
                timestamp: Date.now(),
            };

            Storage.setEpisodeCache('season123', 1, cache);
            const retrieved = Storage.getEpisodeCache('season123', 1);

            expect(retrieved).toEqual(cache);
        });

        it('should return null for non-existent cache', () => {
            const retrieved = Storage.getEpisodeCache('nonexistent', 1);
            expect(retrieved).toBeNull();
        });

        it('should expire old cache (30 days)', () => {
            const oldCache = {
                episodeId: 12345,
                animeTitle: 'Test Anime',
                episodeTitle: 'Episode 1',
                timestamp: Date.now() - 31 * 24 * 60 * 60 * 1000, // 31 days ago
            };

            localStorage.setItem(
                'jellyfin_danmaku_episode_season123_1',
                JSON.stringify(oldCache),
            );

            const retrieved = Storage.getEpisodeCache('season123', 1);
            expect(retrieved).toBeNull();
        });
    });

    describe('DanDanPlay status', () => {
        it('migrates legacy ddplayStatus key', () => {
            localStorage.setItem(
                'ddplayStatus',
                JSON.stringify({
                    isLogin: true,
                    token: 'tok',
                    tokenExpire: '2099-01-01T00:00:00Z',
                    userName: 'alice',
                }),
            );
            const status = Storage.loadDanDanPlayStatus();
            expect(status?.isLogin).toBe(true);
            expect(status?.token).toBe('tok');
            expect(status?.userName).toBe('alice');
            expect(status?.tokenExpire).toBeGreaterThan(Date.now());
            expect(localStorage.getItem('jellyfin_danmaku_ddplay_status')).toBeTruthy();
        });
    });
});
