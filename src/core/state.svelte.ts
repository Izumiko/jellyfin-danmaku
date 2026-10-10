import { Storage } from './storage';
import { API_DEFAULTS, DEFAULT_CONFIG } from './config';
import { eventBus } from './event-bus';
import { logger } from './logger';
import type { DanmakuConfig, EpisodeInfo, SourceStats } from '../types/index';

const CONFIG_KEYS = Object.keys(DEFAULT_CONFIG) as (keyof DanmakuConfig)[];

/** 对象类配置（sourceFilter / modeFilter）复制一份，避免与存档共享引用 */
function cloneValue<T>(value: T): T {
    return value && typeof value === 'object' ? ({ ...value } as T) : value;
}

/**
 * 全局响应式状态
 * 使用 Svelte 5 $state rune 实现真正的响应式
 */
// implements DanmakuConfig：新增配置项时，漏写对应的 $state 字段会直接编译失败
class DanmakuState implements DanmakuConfig {
    // ===== 持久化配置 =====
    opacity = $state(DEFAULT_CONFIG.opacity);
    speed = $state(DEFAULT_CONFIG.speed);
    fontSize = $state(DEFAULT_CONFIG.fontSize);
    heightRatio = $state(DEFAULT_CONFIG.heightRatio);
    fontFamily = $state(DEFAULT_CONFIG.fontFamily);
    fontOptions = $state(DEFAULT_CONFIG.fontOptions);
    danmakuSwitch = $state(DEFAULT_CONFIG.danmakuSwitch);
    logSwitch = $state(DEFAULT_CONFIG.logSwitch);
    chConvert = $state(DEFAULT_CONFIG.chConvert);
    sourceFilter = $state({ ...DEFAULT_CONFIG.sourceFilter });
    modeFilter = $state({ ...DEFAULT_CONFIG.modeFilter });
    densityLimit = $state(DEFAULT_CONFIG.densityLimit);
    useAntiOverlap = $state(DEFAULT_CONFIG.useAntiOverlap);
    useXmlDanmaku = $state(DEFAULT_CONFIG.useXmlDanmaku);
    curEpOffset = $state(DEFAULT_CONFIG.curEpOffset);
    customCorsProxy = $state(DEFAULT_CONFIG.customCorsProxy);
    customApiPrefix = $state(DEFAULT_CONFIG.customApiPrefix);
    blockKeywords = $state(DEFAULT_CONFIG.blockKeywords);
    blockUsers = $state(DEFAULT_CONFIG.blockUsers);
    blockColors = $state(DEFAULT_CONFIG.blockColors);
    blockEnableKeywords = $state(DEFAULT_CONFIG.blockEnableKeywords);
    blockEnableUsers = $state(DEFAULT_CONFIG.blockEnableUsers);
    blockEnableColors = $state(DEFAULT_CONFIG.blockEnableColors);
    mergeSimilar = $state(DEFAULT_CONFIG.mergeSimilar);
    mergeThreshold = $state(DEFAULT_CONFIG.mergeThreshold);
    stripLikeSuffix = $state(DEFAULT_CONFIG.stripLikeSuffix);
    xmlFallback = $state(DEFAULT_CONFIG.xmlFallback);

    // ===== 运行时状态 =====
    episodeInfo = $state<EpisodeInfo | null>(null);
    loading = $state(false);
    isNewJellyfin = $state(false);
    itemId = $state('');
    ddplayLoggedIn = $state(false);
    ddplayUserName = $state('');
    /** 当前加载的弹幕来源与数量（供设置面板展示） */
    loadedSource = $state<'online' | 'local' | null>(null);
    loadedCount = $state(0);
    /** 经过过滤/密度/防重叠后实际交给引擎的条数 */
    visibleCount = $state(0);
    /** 最近一次加载失败的原因（成功加载后清空） */
    loadError = $state<string | null>(null);
    /** 当前弹幕的来源构成，以及被屏蔽规则过滤掉的条数 */
    sourceStats = $state<SourceStats | null>(null);
    blockedCount = $state(0);
    /** 当前条目的番剧名（未匹配时也有，供「测试连接」搜索） */
    currentTitle = $state('');

    constructor() {
        this.hydrate();
    }

    /**
     * 从 localStorage 恢复设置
     */
    hydrate(): void {
        const saved = Storage.loadConfig();
        const target = this as unknown as Record<keyof DanmakuConfig, unknown>;
        for (const key of CONFIG_KEYS) {
            target[key] = cloneValue(saved[key]);
        }
    }

    /**
     * 持久化到 localStorage
     * 同步写入：取消设置时会立刻 hydrate()，延迟写入会让两者竞争。
     */
    persist(): void {
        Storage.saveConfig(this.toConfig());
    }

    /**
     * 修改设置：立即写入状态并持久化，然后通知运行时按影响范围应用。
     * 所有 UI 改动都应走这里，不要直接给字段赋值。
     */
    update(patch: Partial<DanmakuConfig>): void {
        const keys = Object.keys(patch) as (keyof DanmakuConfig)[];
        if (keys.length === 0) return;
        Object.assign(this, patch);
        this.persist();
        if (keys.includes('logSwitch')) logger.setEnabled(this.logSwitch);
        eventBus.emit('settings:changed', { keys });
    }

    /**
     * 导出当前配置
     */
    toConfig(): DanmakuConfig {
        const source = this as unknown as DanmakuConfig;
        const config = {} as Record<keyof DanmakuConfig, unknown>;
        for (const key of CONFIG_KEYS) {
            config[key] = cloneValue(source[key]);
        }
        return config as unknown as DanmakuConfig;
    }

    /**
     * 获取有效的 CORS 代理前缀
     */
    get effectiveCorsProxy(): string {
        return this.customCorsProxy.length > 7 ? this.customCorsProxy : API_DEFAULTS.corsProxy;
    }

    /**
     * 获取完整的 API 前缀（包含 CORS 代理）
     */
    get effectiveApiPrefix(): string {
        return this.customApiPrefix.length > 7 ? this.customApiPrefix : this.effectiveCorsProxy + API_DEFAULTS.apiPrefix;
    }
}

export const danmakuState = new DanmakuState();
