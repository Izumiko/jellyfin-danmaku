import * as v from 'valibot';
import { DanmakuConfigSchema, DEFAULT_CONFIG, mergeConfig } from './config';
import { EPISODE_CACHE_STORE, EPISODE_OFFSET_STORE, idbClear, idbDelete, idbGet, idbGetAll, idbPut } from './idb';
import type { DanmakuConfig, CachedEpisode, DanDanPlayStatus, JellyfinItem } from '../types/index';

const STORAGE_PREFIX = 'jellyfin_danmaku_';
const EPISODE_KEY_PREFIX = `${STORAGE_PREFIX}episode_`;
const EPISODE_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function episodeCacheId(seasonId: string, episodeIndex: number): string {
    return `${seasonId}:${episodeIndex}`;
}

export function episodeScope(item: Pick<JellyfinItem, 'Id' | 'SeasonId' | 'IndexNumber'>): { seasonId: string; episodeIndex: number } {
    const episodeIndex = item.IndexNumber && item.IndexNumber > 0 ? Math.floor(item.IndexNumber) : 1;
    return { seasonId: item.SeasonId || item.Id, episodeIndex };
}

function toCachedEpisode(record: CachedEpisode & { id?: string }): CachedEpisode {
    return {
        episodeId: record.episodeId,
        animeTitle: record.animeTitle,
        episodeTitle: record.episodeTitle,
        timestamp: record.timestamp,
    };
}

export class Storage {
    /**
     * 加载并校验配置
     * 如果数据损坏或校验失败，返回默认配置
     */
    static loadConfig(): DanmakuConfig {
        // 优先读取新版配置
        const raw = localStorage.getItem(`${STORAGE_PREFIX}config`);
        if (raw) {
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

        // 如果没有新版配置，尝试迁移旧版配置
        const migrated = migrateLegacyConfig();
        if (migrated) {
            console.info('[Storage] Migrated legacy config to new format');
            Storage.saveConfig(migrated);
            return migrated;
        }

        return { ...DEFAULT_CONFIG };
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
    static async getEpisodeCache(seasonId: string, episodeIndex: number): Promise<CachedEpisode | null> {
        const id = episodeCacheId(seasonId, episodeIndex);
        try {
            const record = await idbGet<CachedEpisode & { id: string }>(EPISODE_CACHE_STORE, id);
            if (!record) return null;
            if (Date.now() - record.timestamp > EPISODE_CACHE_MAX_AGE_MS) {
                await idbDelete(EPISODE_CACHE_STORE, id);
                return null;
            }
            return toCachedEpisode(record);
        } catch (error) {
            console.error('[Storage] Failed to get episode cache:', error);
            return null;
        }
    }

    /**
     * 设置剧集匹配缓存
     */
    static async setEpisodeCache(seasonId: string, episodeIndex: number, data: CachedEpisode): Promise<void> {
        try {
            await idbPut(EPISODE_CACHE_STORE, { id: episodeCacheId(seasonId, episodeIndex), ...data });
        } catch (error) {
            console.error('[Storage] Failed to set episode cache:', error);
        }
    }

    static async migrateEpisodeCacheFromLocalStorage(): Promise<void> {
        try {
            const keys: string[] = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key?.startsWith(EPISODE_KEY_PREFIX)) keys.push(key);
            }
            for (const key of keys) {
                const rest = key.slice(EPISODE_KEY_PREFIX.length);
                const sep = rest.lastIndexOf('_');
                const raw = localStorage.getItem(key);
                localStorage.removeItem(key);
                if (sep < 0 || !raw) continue;
                try {
                    const parsed = JSON.parse(raw) as CachedEpisode;
                    const seasonId = rest.slice(0, sep);
                    const episodeIndex = Number(rest.slice(sep + 1));
                    if (!Number.isFinite(episodeIndex) || typeof parsed.episodeId !== 'number') continue;
                    await Storage.setEpisodeCache(seasonId, episodeIndex, parsed);
                } catch {
                    /* drop corrupt key */
                }
            }
        } catch (error) {
            console.warn('[Storage] Failed to migrate episode cache:', error);
        }
    }

    static async sweepExpiredEpisodeCache(maxAgeMs = EPISODE_CACHE_MAX_AGE_MS): Promise<void> {
        try {
            const records = await idbGetAll<CachedEpisode & { id: string }>(EPISODE_CACHE_STORE);
            const now = Date.now();
            await Promise.all(records.filter((record) => now - record.timestamp > maxAgeMs).map((record) => idbDelete(EPISODE_CACHE_STORE, record.id)));
        } catch (error) {
            console.warn('[Storage] Failed to sweep episode cache:', error);
        }
    }

    static async setEpisodeOffset(seasonId: string, episodeIndex: number, offset: number): Promise<void> {
        try {
            await idbPut(EPISODE_OFFSET_STORE, { id: episodeCacheId(seasonId, episodeIndex), offset });
        } catch (error) {
            console.error('[Storage] Failed to set episode offset:', error);
        }
    }

    static async getEpisodeOffset(seasonId: string, episodeIndex: number): Promise<number> {
        try {
            const start = Number.isFinite(episodeIndex) && episodeIndex > 0 ? Math.floor(episodeIndex) : 1;
            for (let index = start; index >= 1; index--) {
                const record = await idbGet<{ id: string; offset: number }>(EPISODE_OFFSET_STORE, episodeCacheId(seasonId, index));
                if (record && typeof record.offset === 'number' && Number.isFinite(record.offset)) {
                    return record.offset;
                }
            }
            return 0;
        } catch (error) {
            console.error('[Storage] Failed to get episode offset:', error);
            return 0;
        }
    }

    /**
     * 加载 DanDanPlay 登录状态
     */
    static loadDanDanPlayStatus(): DanDanPlayStatus | null {
        try {
            const newKey = `${STORAGE_PREFIX}ddplay_status`;
            let raw = localStorage.getItem(newKey);
            const fromLegacy = !raw;
            if (!raw) {
                raw = localStorage.getItem('ddplayStatus');
            }
            if (!raw) return null;

            const parsed = JSON.parse(raw) as {
                isLogin: boolean;
                token: string;
                tokenExpire: number | string;
                userName?: string;
            };
            const tokenExpire = typeof parsed.tokenExpire === 'number' ? parsed.tokenExpire : new Date(parsed.tokenExpire).getTime();
            const status: DanDanPlayStatus = {
                isLogin: parsed.isLogin,
                token: parsed.token,
                tokenExpire,
                userName: parsed.userName,
            };

            if (fromLegacy) {
                Storage.saveDanDanPlayStatus(status);
            }

            return status;
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
    static async clear(): Promise<void> {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key) keys.push(key);
        }
        keys.forEach((key) => {
            if (key.startsWith(STORAGE_PREFIX)) {
                localStorage.removeItem(key);
            }
        });
        try {
            await idbClear(EPISODE_CACHE_STORE);
            await idbClear(EPISODE_OFFSET_STORE);
        } catch (error) {
            console.warn('[Storage] Failed to clear episode cache:', error);
        }
    }
}

/**
 * 从旧版独立 key 迁移配置到新版统一格式
 * 旧版 key: chConvert, danmakuSwitch, danmakuopacity, danmakuspeed 等
 */
function migrateLegacyConfig(): DanmakuConfig | null {
    const hasLegacy = localStorage.getItem('danmakuSwitch') !== null;
    if (!hasLegacy) return null;

    try {
        const config: Partial<DanmakuConfig> = {};

        // 辅助函数：读取旧版 number/boolean
        const getBool = (key: string): boolean | undefined => {
            const val = localStorage.getItem(key);
            if (val === null) return undefined;
            return val === '1' || val === 'true';
        };

        const getNumber = (key: string): number | undefined => {
            const val = localStorage.getItem(key);
            if (val === null) return undefined;
            const n = parseFloat(val);
            return isNaN(n) ? undefined : n;
        };

        const getString = (key: string): string | undefined => {
            return localStorage.getItem(key) ?? undefined;
        };

        // 基础设置
        const chConvert = getNumber('chConvert');
        if (chConvert !== undefined) config.chConvert = Math.min(2, Math.max(0, Math.floor(chConvert)));

        const danmakuSwitch = getBool('danmakuSwitch');
        if (danmakuSwitch !== undefined) config.danmakuSwitch = danmakuSwitch;

        const logSwitch = getBool('logSwitch');
        if (logSwitch !== undefined) config.logSwitch = logSwitch;

        const opacity = getNumber('danmakuopacity');
        if (opacity !== undefined) config.opacity = Math.max(0, Math.min(1, opacity));

        const speed = getNumber('danmakuspeed');
        if (speed !== undefined) config.speed = Math.max(50, Math.min(600, speed));

        const fontSize = getNumber('danmakusize');
        if (fontSize !== undefined) config.fontSize = Math.max(10, Math.min(60, fontSize));

        const heightRatio = getNumber('danmakuheight');
        if (heightRatio !== undefined) config.heightRatio = Math.max(0.1, Math.min(1, heightRatio));

        // 字体
        const fontFamily = getString('danmakuFontFamily');
        if (fontFamily) config.fontFamily = fontFamily;

        const fontOptions = getString('danmakuFontOptions');
        if (fontOptions !== undefined) config.fontOptions = fontOptions;

        // 密度限制
        const densityLimit = getNumber('danmakuDensityLimit');
        if (densityLimit !== undefined) config.densityLimit = Math.min(3, Math.max(0, Math.floor(densityLimit)));

        // 防重叠
        const useAntiOverlap = getBool('useAnitOverlap');
        if (useAntiOverlap !== undefined) config.useAntiOverlap = useAntiOverlap;

        // XML 弹幕
        const useXmlDanmaku = getBool('useXmlDanmaku');
        if (useXmlDanmaku !== undefined) config.useXmlDanmaku = useXmlDanmaku;

        // 自定义代理和 API
        const customCorsProxy = getString('customCorsProxy');
        if (customCorsProxy !== undefined) config.customCorsProxy = customCorsProxy;

        const customApiPrefix = getString('customApiPrefix');
        if (customApiPrefix !== undefined) config.customApiPrefix = customApiPrefix;

        // 来源过滤 (bitmask -> object)
        const danmakuFilter = getNumber('danmakuFilter');
        if (danmakuFilter !== undefined) {
            config.sourceFilter = {
                bilibili: (danmakuFilter & 1) !== 1, // bit 0: 1=disable
                gamer: (danmakuFilter & 2) !== 2, // bit 1: 2=disable
                dandanplay: (danmakuFilter & 4) !== 4, // bit 2: 4=disable
                other: (danmakuFilter & 8) !== 8, // bit 3: 8=disable
            };
        }

        // 模式过滤 (bitmask -> object)
        const danmakuModeFilter = getNumber('danmakuModeFilter');
        if (danmakuModeFilter !== undefined) {
            config.modeFilter = {
                bottom: (danmakuModeFilter & 1) !== 1, // bit 0: 1=disable bottom
                top: (danmakuModeFilter & 2) !== 2, // bit 1: 2=disable top
                scroll: (danmakuModeFilter & 4) !== 4, // bit 2: 4=disable scroll
            };
        }

        return mergeConfig(config);
    } catch (error) {
        console.error('[Storage] Failed to migrate legacy config:', error);
        return null;
    }
}
