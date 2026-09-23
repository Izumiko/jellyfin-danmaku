// ===== 枚举 =====

/** 简繁转换模式 */
export enum ChConvertMode {
    None = 0,
    Simplified = 1,
    Traditional = 2,
}

/** 弹幕密度限制 */
export enum DensityLimit {
    Unlimited = 0,
    Low = 1,
    Medium = 2,
    High = 3,
}

/** 弹幕显示模式 */
export type DanmakuMode = 'rtl' | 'ltr' | 'top' | 'bottom';

/** 日志级别 */
export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
}

/** 错误代码 */
export enum ErrorCode {
    Network = 'NETWORK',
    Timeout = 'TIMEOUT',
    HttpError = 'HTTP_ERROR',
    ParseError = 'PARSE_ERROR',
    Cancelled = 'CANCELLED',
    NotFound = 'NOT_FOUND',
    InvalidData = 'INVALID_DATA',
}

// ===== 数据结构 =====

/** 弹幕来源过滤配置 */
export interface SourceFilter {
    bilibili: boolean;
    gamer: boolean;
    dandanplay: boolean;
    other: boolean;
}

/** 弹幕模式过滤配置 */
export interface ModeFilter {
    scroll: boolean;
    top: boolean;
    bottom: boolean;
}

/** 用户持久化配置 */
export interface DanmakuConfig {
    opacity: number;
    speed: number;
    fontSize: number;
    heightRatio: number;
    fontFamily: string;
    fontOptions: string;
    danmakuSwitch: boolean;
    logSwitch: boolean;
    chConvert: ChConvertMode;
    sourceFilter: SourceFilter;
    modeFilter: ModeFilter;
    densityLimit: DensityLimit;
    useAntiOverlap: boolean;
    useXmlDanmaku: boolean;
    curEpOffset: number;
    customCorsProxy: string;
    customApiPrefix: string;
}

/** DanDanPlay API 返回的原始评论 */
export interface RawComment {
    /** 弹幕出现时间（秒） */
    time: number;
    /** DanDanPlay 模式 ID：1=rtl, 4=bottom, 5=top, 6=ltr */
    modeId: number;
    /** 颜色（整数） */
    color: number;
    /** 弹幕文本 */
    text: string;
    /** 用户标识（如 [BiliBili]xxx） */
    user?: string;
}

/** 处理后的弹幕评论（引擎接受的格式） */
export interface ProcessedComment {
    text: string;
    mode: DanmakuMode;
    time: number;
    style: {
        font: string;
        fillStyle: string;
        strokeStyle: string;
        lineWidth: number;
    };
}

/** 匹配到的剧集信息 */
export interface EpisodeInfo {
    episodeId: number;
    animeTitle: string;
    episodeTitle: string;
}

/** DanDanPlay 登录状态 */
export interface DanDanPlayStatus {
    isLogin: boolean;
    token: string;
    tokenExpire: number; // Unix 时间戳
    userName?: string;
}

/** Jellyfin 媒体项（简化） */
export interface JellyfinItem {
    Id: string;
    Name: string;
    SeriesName?: string;
    SeriesId?: string;
    SeasonId?: string;
    IndexNumber?: number; // 集数
    ParentIndexNumber?: number; // 季数
    OriginalTitle?: string;
    ProductionYear?: number;
}

/** DanDanPlay 搜索结果 */
export interface SearchResponse {
    hasMore: boolean;
    animes: AnimeInfo[];
    errorCode: number;
    errorMessage: string;
}

/** 动画信息 */
export interface AnimeInfo {
    animeId: number;
    animeTitle: string;
    type: string;
    typeDescription?: string;
    episodes: EpisodeItem[];
}

/** 剧集列表项 */
export interface EpisodeItem {
    episodeId: number;
    episodeTitle: string;
    episodeNumber?: number | string;
}

/** /api/v2/bangumi/{animeId} 响应 */
export interface BangumiResponse {
    bangumi: AnimeInfo;
    errorCode: number;
    errorMessage: string;
}

/** 关联弹幕源 */
export interface RelatedSource {
    url: string;
    shift: number;
}

/** 日志条目 */
export interface LogEntry {
    timestamp: number;
    level: LogLevel;
    module: string;
    message: string;
    data?: unknown;
    /** 连续相同日志的累计次数 */
    repeat?: number;
}

/** DanDanPlay 评论响应 */
export interface DanDanPlayComment {
    cid: number;
    p: string; // "time,mode,color,user"
    m: string; // 弹幕文本
}

/** 缓存的剧集信息 */
export interface CachedEpisode {
    episodeId: number;
    animeTitle: string;
    episodeTitle: string;
    timestamp: number;
}

/** HTTP 请求选项 */
export interface RequestOptions {
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
    timeout?: number;
    retries?: number;
    retryDelay?: number;
    signal?: AbortSignal;
}

/** 弹幕引擎配置 */
export interface EngineConfig {
    container: HTMLElement;
    media: HTMLVideoElement;
    comments: ProcessedComment[];
    speed: number;
    opacity: number;
    heightRatio: number;
    visible: boolean;
}

/** 弹幕预处理配置 */
export interface ProcessingConfig {
    sourceFilter: SourceFilter;
    modeFilter: ModeFilter;
    densityLimit: DensityLimit;
    fontSize: number;
    fontFamily: string;
    fontOptions: string;
    speed: number;
    timeOffset: number;
    containerWidth: number;
    containerHeight: number;
}

/** 防重叠配置 */
export interface AntiOverlapConfig {
    containerWidth: number;
    containerHeight: number;
    fontSize: number;
    speed: number;
    fontFamily: string;
    fontOptions: string;
}

/** 自定义错误类 */
export class DanmakuError extends Error {
    constructor(
        message: string,
        public readonly code: ErrorCode,
        public readonly cause?: unknown,
    ) {
        super(message);
        this.name = 'DanmakuError';
    }
}
