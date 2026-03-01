import * as v from 'valibot';
import { DanmakuConfigSchema, DEFAULT_CONFIG, mergeConfig } from './config';
import type { DanmakuConfig, CachedEpisode, DanDanPlayStatus } from '../types/index';

const STORAGE_PREFIX = 'jellyfin_danmaku_';

export class Storage {
    /**
     * 加载并校验配置
     * 如果数据损坏或校验失败，返回默认配置
     */
    static loadConfig(): DanmakuConfig {
        const raw = localStorage.getItem(`${STORAGE_PREFIX}config`);
        if (!raw) return { ...DEFAULT_CONFIG };

        try {
            const parsed = JSON.parse(raw);
            const result = v.safeParse(DanmakuConfigSchema, parsed);

            if (result.success) {
                return result.output;
            } else {
                // 部分校验失败，合并有效字段
                console.warn('[Storage] Config validation failed, using partial merge:', result.issues);
                return mergeConfig(parsed);
            }
        } catch (error) {
            console.error('[Storage] Failed to load config:', error);
            return { ...DEFAULT_CONFIG };
        }
    }

    /**
     * 保存配置
     */
    static saveConfig(config: DanmakuConfig): void {
        try {
            localStorage.setItem(`${STORAGE_PREFIX}config`, JSON.stringify(config));
        } catch (error) {
            console.error('[Storage] Failed to save config:', error);
        }
    }

    /**
     * 获取剧集匹配缓存
     */
    static getEpisodeCache(seasonId: string, episodeIndex?: number): CachedEpisode | null {
        try {
            const key =
                episodeIndex !== undefined
                    ? `${STORAGE_PREFIX}episode_${seasonId}_${episodeIndex}`
                    : `${STORAGE_PREFIX}episode_${seasonId}`;

            const raw = localStorage.getItem(key);
            if (!raw) return null;

            const cached = JSON.parse(raw) as CachedEpisode;
            // 缓存 30 天过期
            if (Date.now() - cached.timestamp > 30 * 24 * 60 * 60 * 1000) {
                localStorage.removeItem(key);
                return null;
            }

            return cached;
        } catch (error) {
            console.error('[Storage] Failed to get episode cache:', error);
            return null;
        }
    }

    /**
     * 设置剧集匹配缓存
     */
    static setEpisodeCache(seasonId: string, episodeIndex: number, data: CachedEpisode): void {
        try {
            const key = `${STORAGE_PREFIX}episode_${seasonId}_${episodeIndex}`;
            localStorage.setItem(key, JSON.stringify(data));
        } catch (error) {
            console.error('[Storage] Failed to set episode cache:', error);
        }
    }

    /**
     * 加载 DanDanPlay 登录状态
     */
    static loadDanDanPlayStatus(): DanDanPlayStatus | null {
        try {
            const raw = localStorage.getItem(`${STORAGE_PREFIX}ddplay_status`);
            if (!raw) return null;
            return JSON.parse(raw) as DanDanPlayStatus;
        } catch (error) {
            console.error('[Storage] Failed to load DanDanPlay status:', error);
            return null;
        }
    }

    /**
     * 保存 DanDanPlay 登录状态
     */
    static saveDanDanPlayStatus(status: DanDanPlayStatus): void {
        try {
            localStorage.setItem(`${STORAGE_PREFIX}ddplay_status`, JSON.stringify(status));
        } catch (error) {
            console.error('[Storage] Failed to save DanDanPlay status:', error);
        }
    }

    /**
     * 清除所有存储数据
     */
    static clear(): void {
        const keys = Object.keys(localStorage);
        keys.forEach((key) => {
            if (key.startsWith(STORAGE_PREFIX)) {
                localStorage.removeItem(key);
            }
        });
    }
}
