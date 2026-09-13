import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Storage } from '@/core/storage';
import { DEFAULT_CONFIG } from '@/core/config';
import type { DanmakuConfig } from '@/types/index';
import * as idb from '@/core/idb';

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
        const cache = {
            episodeId: 12345,
            animeTitle: 'Test Anime',
            episodeTitle: 'Episode 1',
            timestamp: Date.now(),
        };

        it('stores and retrieves from IndexedDB not localStorage', async () => {
            await Storage.setEpisodeCache('season123', 1, cache);

            expect(localStorage.getItem('jellyfin_danmaku_episode_season123_1')).toBeNull();
            await expect(Storage.getEpisodeCache('season123', 1)).resolves.toEqual(cache);
        });

        it('returns null for missing cache', async () => {
            await expect(Storage.getEpisodeCache('nonexistent', 1)).resolves.toBeNull();
        });

        it('expires cache older than 30 days', async () => {
            await Storage.setEpisodeCache('season123', 1, {
                ...cache,
                timestamp: Date.now() - 31 * 24 * 60 * 60 * 1000,
            });
            await expect(Storage.getEpisodeCache('season123', 1)).resolves.toBeNull();
            await expect(Storage.getEpisodeCache('season123', 1)).resolves.toBeNull();
        });

        it('migrates jellyfin_danmaku_episode_* keys into IndexedDB', async () => {
            localStorage.setItem('jellyfin_danmaku_episode_season123_1', JSON.stringify(cache));
            await Storage.migrateEpisodeCacheFromLocalStorage();
            expect(localStorage.getItem('jellyfin_danmaku_episode_season123_1')).toBeNull();
            await expect(Storage.getEpisodeCache('season123', 1)).resolves.toEqual(cache);
        });

        it('returns null when IndexedDB get fails', async () => {
            const spy = vi.spyOn(idb, 'idbGet').mockRejectedValueOnce(new Error('idb down'));
            await expect(Storage.getEpisodeCache('season123', 1)).resolves.toBeNull();
            spy.mockRestore();
        });

        it('sweepExpiredEpisodeCache removes stale records', async () => {
            await Storage.setEpisodeCache('season123', 1, {
                ...cache,
                timestamp: Date.now() - 31 * 24 * 60 * 60 * 1000,
            });
            await Storage.setEpisodeCache('season123', 2, cache);
            await Storage.sweepExpiredEpisodeCache();
            await expect(Storage.getEpisodeCache('season123', 1)).resolves.toBeNull();
            await expect(Storage.getEpisodeCache('season123', 2)).resolves.toEqual(cache);
        });
    });

    describe('episode offset', () => {
        it('returns 0 when no offset is stored', async () => {
            await expect(Storage.getEpisodeOffset('season-a', 3)).resolves.toBe(0);
        });

        it('returns the episode own offset when set', async () => {
            await Storage.setEpisodeOffset('season-a', 3, 1.5);
            await expect(Storage.getEpisodeOffset('season-a', 3)).resolves.toBe(1.5);
        });

        it('inherits previous episode offset when current is unset', async () => {
            await Storage.setEpisodeOffset('season-a', 1, 2.5);
            await expect(Storage.getEpisodeOffset('season-a', 3)).resolves.toBe(2.5);
            await expect(Storage.getEpisodeOffset('season-a', 2)).resolves.toBe(2.5);
        });

        it('does not inherit after current episode is set', async () => {
            await Storage.setEpisodeOffset('season-a', 1, 2.5);
            await Storage.setEpisodeOffset('season-a', 3, 0.5);
            await expect(Storage.getEpisodeOffset('season-a', 3)).resolves.toBe(0.5);
            await expect(Storage.getEpisodeOffset('season-a', 2)).resolves.toBe(2.5);
        });
    });

    describe('season anime', () => {
        it('stores and retrieves season anime mapping', async () => {
            await Storage.setSeasonAnime('season-1', { animeId: 88, animeTitle: '弹弹正确名' });
            await expect(Storage.getSeasonAnime('season-1')).resolves.toEqual({
                animeId: 88,
                animeTitle: '弹弹正确名',
            });
        });

        it('stores and retrieves the episode index offset', async () => {
            await Storage.setSeasonAnime('season-3', { animeId: 88, animeTitle: '弹弹正确名', episodeIndexOffset: 12 });
            await expect(Storage.getSeasonAnime('season-3')).resolves.toEqual({
                animeId: 88,
                animeTitle: '弹弹正确名',
                episodeIndexOffset: 12,
            });
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
