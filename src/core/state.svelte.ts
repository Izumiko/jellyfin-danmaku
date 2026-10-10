import { Storage } from './storage';
import { API_DEFAULTS, DEFAULT_CONFIG } from './config';
import type { DanmakuConfig, EpisodeInfo } from '../types/index';

/**
 * 全局响应式状态
 * 使用 Svelte 5 $state rune 实现真正的响应式
 */
class DanmakuState {
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

    // ===== 运行时状态 =====
    episodeInfo = $state<EpisodeInfo | null>(null);
    loading = $state(false);
    isNewJellyfin = $state(false);
    itemId = $state('');
    ddplayLoggedIn = $state(false);
    ddplayUserName = $state('');

    constructor() {
        this.hydrate();
    }

    /**
     * 从 localStorage 恢复设置
     */
    hydrate(): void {
        const saved = Storage.loadConfig();
        this.opacity = saved.opacity;
        this.speed = saved.speed;
        this.fontSize = saved.fontSize;
        this.heightRatio = saved.heightRatio;
        this.fontFamily = saved.fontFamily;
        this.fontOptions = saved.fontOptions;
        this.danmakuSwitch = saved.danmakuSwitch;
        this.logSwitch = saved.logSwitch;
        this.chConvert = saved.chConvert;
        this.sourceFilter = { ...saved.sourceFilter };
        this.modeFilter = { ...saved.modeFilter };
        this.densityLimit = saved.densityLimit;
        this.useAntiOverlap = saved.useAntiOverlap;
        this.useXmlDanmaku = saved.useXmlDanmaku;
        this.curEpOffset = saved.curEpOffset;
        this.customCorsProxy = saved.customCorsProxy;
        this.customApiPrefix = saved.customApiPrefix;
    }

    /**
     * 持久化到 localStorage
     * 同步写入：取消设置时会立刻 hydrate()，延迟写入会让两者竞争。
     */
    persist(): void {
        Storage.saveConfig(this.toConfig());
    }

    /**
     * 导出当前配置
     */
    toConfig(): DanmakuConfig {
        return {
            opacity: this.opacity,
            speed: this.speed,
            fontSize: this.fontSize,
            heightRatio: this.heightRatio,
            fontFamily: this.fontFamily,
            fontOptions: this.fontOptions,
            danmakuSwitch: this.danmakuSwitch,
            logSwitch: this.logSwitch,
            chConvert: this.chConvert,
            sourceFilter: { ...this.sourceFilter },
            modeFilter: { ...this.modeFilter },
            densityLimit: this.densityLimit,
            useAntiOverlap: this.useAntiOverlap,
            useXmlDanmaku: this.useXmlDanmaku,
            curEpOffset: this.curEpOffset,
            customCorsProxy: this.customCorsProxy,
            customApiPrefix: this.customApiPrefix,
        };
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
