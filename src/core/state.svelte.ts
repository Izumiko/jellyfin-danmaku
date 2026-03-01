import { Storage } from './storage';
import { DEFAULT_CONFIG } from './config';
import { debounce } from '../utils/dom';
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
    customCorsProxy = $state(DEFAULT_CONFIG.customCorsProxy);
    customApiPrefix = $state(DEFAULT_CONFIG.customApiPrefix);

    // ===== 运行时状态 =====
    episodeInfo = $state<EpisodeInfo | null>(null);
    loading = $state(false);
    isNewJellyfin = $state(false);
    itemId = $state('');

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
        this.customCorsProxy = saved.customCorsProxy;
        this.customApiPrefix = saved.customApiPrefix;
    }

    /**
     * 持久化到 localStorage（debounced）
     */
    persist = debounce(() => {
        Storage.saveConfig(this.toConfig());
    }, 300);

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
            customCorsProxy: this.customCorsProxy,
            customApiPrefix: this.customApiPrefix,
        };
    }

    /**
     * 获取有效的 API 前缀
     */
    get effectiveApiPrefix(): string {
        return this.customApiPrefix || 'https://api.dandanplay.net';
    }

    /**
     * 获取有效的 CORS 代理
     */
    get effectiveCorsProxy(): string {
        return this.customCorsProxy || 'https://ddplay-api.930524.xyz/cors/';
    }
}

export const danmakuState = new DanmakuState();
