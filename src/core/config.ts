import * as v from 'valibot';
import { ChConvertMode, DensityLimit, type DanmakuConfig } from '../types/index';

/** 弹幕显示配置的默认值 */
export const DEFAULT_CONFIG: DanmakuConfig = {
    opacity: 0.7,
    speed: 200,
    fontSize: 18,
    heightRatio: 0.9,
    fontFamily: 'sans-serif',
    fontOptions: '',
    danmakuSwitch: true,
    logSwitch: false,
    chConvert: ChConvertMode.None,
    sourceFilter: { bilibili: true, gamer: true, dandanplay: true, other: true },
    modeFilter: { scroll: true, top: true, bottom: true },
    densityLimit: DensityLimit.Unlimited,
    useAntiOverlap: false,
    useXmlDanmaku: false,
    curEpOffset: 0,
    customCorsProxy: '',
    customApiPrefix: '',
};

/** 配置值合法范围 */
export const CONFIG_CONSTRAINTS = {
    opacity: { min: 0, max: 1 },
    speed: { min: 50, max: 600 },
    fontSize: { min: 10, max: 60 },
    heightRatio: { min: 0.1, max: 1.0 },
} as const;

/** API 默认配置 */
export const API_DEFAULTS = {
    corsProxy: 'https://ddplay-api.930524.xyz/cors/',
    apiPrefix: 'https://api.dandanplay.net',
    requestTimeout: 10_000,
    maxRetries: 2,
} as const;

/** DOM 选择器常量 */
export const SELECTORS = {
    videoPlayer: '.htmlvideoplayer',
    videoContainer: '.videoPlayerContainer',
    mediaContainer: ".page[data-type='video-osd']:not(.hide)",
    pauseButton: '.btnPause',
    actionSheet: '.actionSheet',
    skinHeader: 'div.skinHeader',
    reactRoot: '#reactRoot',
} as const;

/** Valibot schema - SourceFilter */
const SourceFilterSchema = v.object({
    bilibili: v.boolean(),
    gamer: v.boolean(),
    dandanplay: v.boolean(),
    other: v.boolean(),
});

/** Valibot schema - ModeFilter */
const ModeFilterSchema = v.object({
    scroll: v.boolean(),
    top: v.boolean(),
    bottom: v.boolean(),
});

/** Valibot schema - DanmakuConfig */
export const DanmakuConfigSchema = v.object({
    opacity: v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
    speed: v.pipe(v.number(), v.minValue(50), v.maxValue(600)),
    fontSize: v.pipe(v.number(), v.minValue(10), v.maxValue(60)),
    heightRatio: v.pipe(v.number(), v.minValue(0.1), v.maxValue(1.0)),
    fontFamily: v.string(),
    fontOptions: v.string(),
    danmakuSwitch: v.boolean(),
    logSwitch: v.boolean(),
    chConvert: v.pipe(v.number(), v.minValue(0), v.maxValue(2)),
    sourceFilter: SourceFilterSchema,
    modeFilter: ModeFilterSchema,
    densityLimit: v.pipe(v.number(), v.minValue(0), v.maxValue(3)),
    useAntiOverlap: v.boolean(),
    useXmlDanmaku: v.boolean(),
    curEpOffset: v.number(),
    customCorsProxy: v.string(),
    customApiPrefix: v.string(),
});

/**
 * 验证并修正配置值
 * 如果值超出范围，自动 clamp 到合法范围
 */
export function validateConfigValue<K extends keyof DanmakuConfig>(key: K, value: DanmakuConfig[K]): DanmakuConfig[K] {
    if (key === 'opacity') {
        return Math.max(CONFIG_CONSTRAINTS.opacity.min, Math.min(CONFIG_CONSTRAINTS.opacity.max, value as number)) as DanmakuConfig[K];
    }
    if (key === 'speed') {
        return Math.max(CONFIG_CONSTRAINTS.speed.min, Math.min(CONFIG_CONSTRAINTS.speed.max, value as number)) as DanmakuConfig[K];
    }
    if (key === 'fontSize') {
        return Math.max(CONFIG_CONSTRAINTS.fontSize.min, Math.min(CONFIG_CONSTRAINTS.fontSize.max, value as number)) as DanmakuConfig[K];
    }
    if (key === 'heightRatio') {
        return Math.max(CONFIG_CONSTRAINTS.heightRatio.min, Math.min(CONFIG_CONSTRAINTS.heightRatio.max, value as number)) as DanmakuConfig[K];
    }
    return value;
}

/**
 * 合并部分配置到默认配置
 * 用于从 localStorage 恢复时的部分数据合并
 */
export function mergeConfig(partial: Partial<DanmakuConfig> | unknown): DanmakuConfig {
    const input = partial && typeof partial === 'object' ? (partial as Partial<DanmakuConfig>) : {};

    const numberOr = (value: unknown, fallback: number): number =>
        typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    const booleanOr = (value: unknown, fallback: boolean): boolean =>
        typeof value === 'boolean' ? value : fallback;
    const stringOr = (value: unknown, fallback: string): string =>
        typeof value === 'string' ? value : fallback;

    const source =
        input.sourceFilter && typeof input.sourceFilter === 'object'
            ? input.sourceFilter
            : DEFAULT_CONFIG.sourceFilter;
    const mode =
        input.modeFilter && typeof input.modeFilter === 'object'
            ? input.modeFilter
            : DEFAULT_CONFIG.modeFilter;

    const chConvert = Math.max(0, Math.min(2, Math.floor(numberOr(input.chConvert, DEFAULT_CONFIG.chConvert)))) as ChConvertMode;
    const densityLimit = Math.max(
        0,
        Math.min(3, Math.floor(numberOr(input.densityLimit, DEFAULT_CONFIG.densityLimit))),
    ) as DensityLimit;

    return {
        opacity: validateConfigValue('opacity', numberOr(input.opacity, DEFAULT_CONFIG.opacity)),
        speed: validateConfigValue('speed', numberOr(input.speed, DEFAULT_CONFIG.speed)),
        fontSize: validateConfigValue('fontSize', numberOr(input.fontSize, DEFAULT_CONFIG.fontSize)),
        heightRatio: validateConfigValue(
            'heightRatio',
            numberOr(input.heightRatio, DEFAULT_CONFIG.heightRatio),
        ),
        fontFamily: stringOr(input.fontFamily, DEFAULT_CONFIG.fontFamily),
        fontOptions: stringOr(input.fontOptions, DEFAULT_CONFIG.fontOptions),
        danmakuSwitch: booleanOr(input.danmakuSwitch, DEFAULT_CONFIG.danmakuSwitch),
        logSwitch: booleanOr(input.logSwitch, DEFAULT_CONFIG.logSwitch),
        chConvert,
        sourceFilter: {
            bilibili: booleanOr(source.bilibili, DEFAULT_CONFIG.sourceFilter.bilibili),
            gamer: booleanOr(source.gamer, DEFAULT_CONFIG.sourceFilter.gamer),
            dandanplay: booleanOr(source.dandanplay, DEFAULT_CONFIG.sourceFilter.dandanplay),
            other: booleanOr(source.other, DEFAULT_CONFIG.sourceFilter.other),
        },
        modeFilter: {
            scroll: booleanOr(mode.scroll, DEFAULT_CONFIG.modeFilter.scroll),
            top: booleanOr(mode.top, DEFAULT_CONFIG.modeFilter.top),
            bottom: booleanOr(mode.bottom, DEFAULT_CONFIG.modeFilter.bottom),
        },
        densityLimit,
        useAntiOverlap: booleanOr(input.useAntiOverlap, DEFAULT_CONFIG.useAntiOverlap),
        useXmlDanmaku: booleanOr(input.useXmlDanmaku, DEFAULT_CONFIG.useXmlDanmaku),
        curEpOffset: numberOr(input.curEpOffset, DEFAULT_CONFIG.curEpOffset),
        customCorsProxy: stringOr(input.customCorsProxy, DEFAULT_CONFIG.customCorsProxy),
        customApiPrefix: stringOr(input.customApiPrefix, DEFAULT_CONFIG.customApiPrefix),
    };
}
