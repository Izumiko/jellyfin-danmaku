# Jellyfin-Danmaku 重构规格说明书

## 1. 项目概述

### 1.1 背景

Jellyfin-Danmaku 是一个纯客户端 JavaScript 插件，为 Jellyfin Web 播放器附加弹幕（弹幕）显示功能。弹幕数据主要来源于 DanDanPlay API（聚合 Bilibili、巴哈姆特、AcFun、爱奇艺等平台评论），也支持通过 Jellyfin 服务端弹幕插件获取本地 XML 弹幕。

当前实现为单一 `ede.js` 文件（3,769 行），包含全部业务逻辑、1,200+ 行内联 CSS、以及内嵌的 minified 弹幕渲染引擎。代码采用全局变量、轮询检测、手动 DOM 构建等模式，缺乏模块化、类型安全和错误处理。

### 1.2 重构目标

| 优先级 | 目标 | 说明 |
|--------|------|------|
| P0 | 代码模块化与可维护性 | 清晰的模块边界、关注点分离、单一职责 |
| P0 | TypeScript 类型安全 | strict 模式，消除 any，运行时数据校验 |
| P0 | 错误处理与健壮性 | 网络重试、超时控制、异常降级、数据校验 |
| P1 | UI/UX 改进 | 组件化设置界面、响应式状态驱动、scoped CSS |
| P1 | 性能优化 | 事件驱动替代轮询、LRU 缓存、debounce、资源清理 |
| P2 | 测试覆盖 | 核心纯函数单元测试、Vitest 基础设施 |

### 1.3 设计原则

1. **可测试的纯函数**：业务逻辑（弹幕处理、匹配算法）为纯函数，所有依赖通过参数注入
2. **响应式状态**：Svelte 5 `$state` rune 驱动 UI 更新，状态变更自动反映到视图
3. **声明式 UI**：Svelte 组件描述"是什么"而非"怎么做"，通过 portal 挂载到 Jellyfin DOM
4. **事件驱动生命周期**：MutationObserver + 自定义事件替代 setInterval 轮询
5. **Disposable 模式**：所有资源（Observer、Listener、Timer）注册时返回清理函数，统一释放

---

## 2. 技术栈

| 层面 | 选型 | 版本 | 理由 |
|------|------|------|------|
| 语言 | TypeScript | 5.x | 完整类型安全，strict 模式 |
| UI 框架 | Svelte | 5.x | 编译型，零运行时开销，产物极小，适合嵌入式插件 |
| 构建工具 | Vite | 6.x | 快速 HMR，原生 ESM 开发，成熟生态 |
| 用户脚本 | vite-plugin-monkey | 7.x | 自动生成 Tampermonkey 元数据块 |
| 运行时校验 | Valibot | 1.x | ~1KB，用于校验 localStorage 持久化数据 |
| 弹幕引擎 | danmaku | 2.x | npm 包引入（替代内嵌 minified 版本） |
| 测试 | Vitest | 3.x | 与 Vite 一体化，原生 TypeScript 支持 |
| 组件测试 | @testing-library/svelte | 5.x | 按用户行为测试组件 |
| 包管理 | pnpm | latest | 磁盘高效，严格依赖提升 |

---

## 3. 目录结构

```
jellyfin-danmaku/
├── src/
│   ├── main.ts                              # 入口守卫 + bootstrap 调用
│   ├── bootstrap.ts                         # 生命周期编排
│   │
│   ├── core/
│   │   ├── config.ts                        # 常量、默认值、Valibot schema
│   │   ├── state.svelte.ts                  # Svelte 5 响应式全局状态
│   │   ├── storage.ts                       # localStorage 封装 + schema 校验
│   │   ├── event-bus.ts                     # 类型安全事件总线
│   │   └── logger.ts                        # 结构化日志系统
│   │
│   ├── services/
│   │   ├── http.ts                          # fetch 封装（超时/重试/abort）
│   │   ├── dandanplay/
│   │   │   ├── client.ts                    # DanDanPlay API 纯函数客户端
│   │   │   ├── auth.ts                      # 登录 + Token 管理
│   │   │   └── types.ts                     # API 请求/响应类型
│   │   ├── jellyfin/
│   │   │   ├── client.ts                    # ApiClient 安全封装
│   │   │   ├── interceptor.ts               # XHR PlaybackInfo 拦截器
│   │   │   └── types.ts                     # Jellyfin 数据类型
│   │   ├── episode-matcher.ts               # 剧集匹配（搜索→选择→缓存）
│   │   └── comment-fetcher.ts               # 弹幕获取编排（多源聚合/降级）
│   │
│   ├── danmaku/
│   │   ├── engine.ts                        # 渲染引擎封装
│   │   ├── processor.ts                     # 预处理（去重/过滤/格式化）
│   │   ├── anti-overlap.ts                  # 防重叠算法
│   │   └── text-measure.ts                  # 文字宽度 LRU 缓存测量
│   │
│   ├── ui/
│   │   ├── App.svelte                       # 根组件（portal 编排）
│   │   ├── components/
│   │   │   ├── DanmakuToggle.svelte         # 弹幕开关按钮
│   │   │   ├── Sidebar.svelte               # 设置侧边栏容器
│   │   │   ├── SettingsTabs.svelte          # 标签页切换器
│   │   │   ├── ControlTab.svelte            # 控制功能
│   │   │   ├── StyleTab.svelte              # 显示样式
│   │   │   ├── DisplayTab.svelte            # 显示设置
│   │   │   ├── FilterTab.svelte             # 过滤设置
│   │   │   ├── InputDialog.svelte           # 通用输入对话框
│   │   │   ├── SelectDialog.svelte          # 通用选择对话框
│   │   │   └── DebugOverlay.svelte          # 调试信息浮层
│   │   ├── actions/
│   │   │   └── portal.ts                    # Svelte action: 挂载到指定 DOM
│   │   └── styles/
│   │       ├── variables.css                # CSS 变量
│   │       └── base.css                     # 基础样式
│   │
│   ├── types/
│   │   ├── index.ts                         # 公共业务类型
│   │   ├── danmaku-engine.d.ts              # danmaku npm 包类型声明
│   │   └── jellyfin.d.ts                    # window.ApiClient 全局声明
│   │
│   └── utils/
│       ├── dom.ts                           # waitForElement（带超时+abort）
│       ├── version.ts                       # 语义版本比较
│       ├── color.ts                         # 颜色整数↔十六进制转换
│       └── disposable.ts                    # Disposable 资源管理
│
├── tests/
│   ├── unit/
│   │   ├── danmaku/
│   │   │   ├── processor.test.ts
│   │   │   ├── anti-overlap.test.ts
│   │   │   └── text-measure.test.ts
│   │   ├── services/
│   │   │   ├── episode-matcher.test.ts
│   │   │   ├── comment-fetcher.test.ts
│   │   │   └── http.test.ts
│   │   ├── core/
│   │   │   ├── storage.test.ts
│   │   │   ├── config.test.ts
│   │   │   └── event-bus.test.ts
│   │   └── utils/
│   │       ├── dom.test.ts
│   │       ├── version.test.ts
│   │       └── color.test.ts
│   └── setup.ts                             # Vitest 全局 setup
│
├── build/
│   ├── vite.standalone.config.ts            # IIFE 独立 JS 构建
│   └── vite.userscript.config.ts            # Tampermonkey 用户脚本构建
│
├── package.json
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.node.json
├── vitest.config.ts
└── .prettierrc.json
```

---

## 4. 模块详细设计

### 4.1 入口与生命周期 — `main.ts` / `bootstrap.ts`

#### 4.1.1 `main.ts` — 入口守卫

职责：Jellyfin 环境检测，唯一入口。

```typescript
// 伪代码
(async function main() {
    // 守卫：检查 <meta name="application-name" content="Jellyfin">
    if (!isJellyfinPage()) return;

    // 启动
    await bootstrap();
})();
```

不包含任何业务逻辑，仅做环境检查后调用 `bootstrap()`。

#### 4.1.2 `bootstrap.ts` — 生命周期编排

职责：协调各模块初始化和清理。

```
bootstrap()
  ├─ 1. detectJellyfinVersion()           // 检测版本，设置 isNewJellyfin
  ├─ 2. interceptPlaybackInfo(callback)    // 安装 XHR 拦截器
  ├─ 3. observePlayerLifecycle()           // MutationObserver 监听视频播放器
  │     ├─ onPlayerCreated:
  │     │   ├─ waitForControlBar()         // 等待播放控制栏 DOM 就绪
  │     │   ├─ mountApp(targets)           // 挂载 Svelte App
  │     │   ├─ setupMenuInjection()        // 安装 actionSheet 菜单注入
  │     │   └─ loadDanmaku()               // 触发弹幕加载流程
  │     └─ onPlayerDestroyed:
  │         └─ cleanup()                   // 销毁 Svelte App + 清理所有资源
  └─ 返回全局 Disposable（用于完全卸载插件）
```

**关键设计**：

- `observePlayerLifecycle()` 使用 MutationObserver 监听 `document.body` 的 `childList` 变化，检测 `.videoPlayerContainer` 的添加/移除，**替代 `setInterval` 轮询**。
- 每个初始化步骤返回清理函数，收集到 `disposables` 数组。
- 当视频播放器被销毁（用户离开视频页）时，执行全部清理。
- 当新视频播放器创建时，重新初始化。

#### 4.1.3 视频变更检测

| 事件 | 检测方式 | 响应 |
|------|----------|------|
| 视频播放器创建 | `MutationObserver` 检测 `.videoPlayerContainer` 添加到 DOM | 初始化 UI + 加载弹幕 |
| 视频播放器销毁 | `MutationObserver` 检测 `.videoPlayerContainer` 从 DOM 移除 | 清理全部资源 |
| 视频源变更（切集） | `MutationObserver` 监听 `<video>` 的 `src` 属性变化（`attributeFilter: ['src']`） | 延迟 2s 后重新加载弹幕 |
| 播放控制栏就绪 | `waitForElement` 带 10s 超时等待 `.btnPause` 出现 | 挂载弹幕开关按钮 |

---

### 4.2 核心层 — `core/`

#### 4.2.1 `config.ts` — 配置与常量

```typescript
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

/** Valibot schema，用于验证 localStorage 数据 */
export const DanmakuConfigSchema = v.object({ ... });

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
    mediaContainer: "div[data-type='video-osd']",
    pauseButton: '.btnPause',
    actionSheet: '.actionSheet',
    skinHeader: 'div.skinHeader',
    reactRoot: '#reactRoot',
} as const;
```

#### 4.2.2 `state.svelte.ts` — 响应式状态

使用 Svelte 5 的 `$state` rune 实现真正的响应式。Svelte 编译器将 `$state` 转换为响应式信号，任何在 Svelte 组件模板或 `$effect` 中读取这些属性的地方都会自动追踪依赖并在值变更时更新。

```typescript
import { debounce } from '../utils/dom';
import { Storage } from './storage';
import { DEFAULT_CONFIG } from './config';
import type { DanmakuConfig, EpisodeInfo } from '../types';

class DanmakuState {
    // ===== 持久化配置（用户设置）=====
    opacity = $state(DEFAULT_CONFIG.opacity);
    speed = $state(DEFAULT_CONFIG.speed);
    fontSize = $state(DEFAULT_CONFIG.fontSize);
    heightRatio = $state(DEFAULT_CONFIG.heightRatio);
    fontFamily = $state(DEFAULT_CONFIG.fontFamily);
    fontOptions = $state(DEFAULT_CONFIG.fontOptions);
    danmakuSwitch = $state(DEFAULT_CONFIG.danmakuSwitch);
    logSwitch = $state(DEFAULT_CONFIG.logSwitch);
    chConvert = $state(DEFAULT_CONFIG.chConvert);
    sourceFilter = $state(DEFAULT_CONFIG.sourceFilter);
    modeFilter = $state(DEFAULT_CONFIG.modeFilter);
    densityLimit = $state(DEFAULT_CONFIG.densityLimit);
    useAntiOverlap = $state(DEFAULT_CONFIG.useAntiOverlap);
    useXmlDanmaku = $state(DEFAULT_CONFIG.useXmlDanmaku);
    customCorsProxy = $state(DEFAULT_CONFIG.customCorsProxy);
    customApiPrefix = $state(DEFAULT_CONFIG.customApiPrefix);

    // ===== 运行时状态（不持久化）=====
    episodeInfo = $state<EpisodeInfo | null>(null);
    loading = $state(false);
    isNewJellyfin = $state(false);
    itemId = $state('');

    constructor() {
        this.hydrate();
    }

    /** 从 localStorage 恢复设置 */
    hydrate(): void {
        const saved = Storage.loadConfig();  // 内部做 Valibot 校验
        if (saved) {
            Object.assign(this, saved);
        }
    }

    /** 持久化到 localStorage（debounced，避免滑块拖动时的 I/O 风暴）*/
    persist = debounce(() => {
        Storage.saveConfig(this.toConfig());
    }, 300);

    /** 导出当前配置为普通对象（用于持久化和传参）*/
    toConfig(): DanmakuConfig { ... }

    /** 获取有效的 API 前缀（考虑用户自定义）*/
    get effectiveApiPrefix(): string {
        return this.customApiPrefix || API_DEFAULTS.apiPrefix;
    }

    /** 获取有效的 CORS 代理（考虑用户自定义）*/
    get effectiveCorsProxy(): string {
        return this.customCorsProxy || API_DEFAULTS.corsProxy;
    }
}

export const danmakuState = new DanmakuState();
```

**vs `ts` 分支的区别**：

- `ts` 分支使用普通 class field + 手动 getter/setter，Svelte 组件无法追踪变化
- 新方案使用 `$state` rune，Svelte 编译器自动生成响应式代码
- 持久化从"每次 setter 立即写入"改为"debounce 300ms 批量写入"

#### 4.2.3 `storage.ts` — 安全存储

```typescript
import * as v from 'valibot';
import { DanmakuConfigSchema, DEFAULT_CONFIG } from './config';

const STORAGE_PREFIX = 'jellyfin_danmaku_';

export class Storage {
    /** 加载并校验配置 */
    static loadConfig(): DanmakuConfig {
        const raw = localStorage.getItem(`${STORAGE_PREFIX}config`);
        if (!raw) return { ...DEFAULT_CONFIG };

        try {
            const parsed = JSON.parse(raw);
            // Valibot 校验：验证失败的字段回退到默认值
            const result = v.safeParse(DanmakuConfigSchema, parsed);
            if (result.success) return result.output;
            // 部分校验：合并有效字段与默认值
            return { ...DEFAULT_CONFIG, ...partialParse(parsed) };
        } catch {
            return { ...DEFAULT_CONFIG };
        }
    }

    /** 保存配置 */
    static saveConfig(config: DanmakuConfig): void {
        localStorage.setItem(`${STORAGE_PREFIX}config`, JSON.stringify(config));
    }

    /** 剧集匹配缓存 - 读取 */
    static getEpisodeCache(seasonId: string, episodeIndex?: number): CachedEpisode | null { ... }

    /** 剧集匹配缓存 - 写入 */
    static setEpisodeCache(seasonId: string, episodeIndex: number, data: CachedEpisode): void { ... }
}
```

**关键改进**：
- 统一存储 key 前缀 `jellyfin_danmaku_`，避免与其他插件冲突
- Valibot schema 校验所有数据，腐化数据自动回退默认值
- 配置整合为单个 JSON 对象存储（替代原来十几个独立 key）

#### 4.2.4 `event-bus.ts` — 类型安全事件系统

```typescript
type EventMap = {
    /** 请求重新加载弹幕 */
    'danmaku:reload': { reason: 'init' | 'search' | 'refresh' | 'settings-changed' };
    /** 弹幕加载完成 */
    'danmaku:loaded': { count: number; source: string };
    /** 弹幕加载失败 */
    'danmaku:error': { error: Error; source: string };
    /** 视频源变更 */
    'media:source-changed': undefined;
    /** 视频播放器被销毁 */
    'media:removed': undefined;
    /** 设置侧边栏打开请求 */
    'settings:open': undefined;
    /** 设置已保存 */
    'settings:saved': undefined;
};

class TypedEventBus {
    private listeners = new Map<string, Set<Function>>();

    /**
     * 订阅事件
     * @returns 取消订阅函数（Disposable 模式）
     */
    on<K extends keyof EventMap>(
        event: K,
        handler: (data: EventMap[K]) => void
    ): () => void { ... }

    /** 发送事件 */
    emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void { ... }

    /** 清除所有订阅 */
    clear(): void { ... }
}

export const eventBus = new TypedEventBus();
```

#### 4.2.5 `logger.ts` — 结构化日志

```typescript
export enum LogLevel { DEBUG, INFO, WARN, ERROR }

class Logger {
    private entries: LogEntry[] = [];
    private maxEntries = 100;

    /**
     * 记录日志
     * 同时输出到 console 和通知 DebugOverlay 组件
     */
    log(level: LogLevel, module: string, message: string, data?: unknown): void { ... }

    /** 获取最近日志（供 DebugOverlay 显示） */
    getRecent(count?: number): LogEntry[] { ... }

    debug(module: string, msg: string, data?: unknown) { ... }
    info(module: string, msg: string, data?: unknown) { ... }
    warn(module: string, msg: string, data?: unknown) { ... }
    error(module: string, msg: string, data?: unknown) { ... }
}

export const logger = new Logger();
```

---

### 4.3 服务层 — `services/`

#### 4.3.1 `http.ts` — 统一 HTTP 客户端

```typescript
export interface RequestOptions {
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
    timeout?: number;      // 默认 10000ms
    retries?: number;       // 默认 2
    retryDelay?: number;    // 初始重试间隔，默认 1000ms
    signal?: AbortSignal;   // 外部取消信号
}

/**
 * 统一 HTTP 请求函数
 *
 * 特性：
 * - AbortController 超时控制
 * - 指数退避重试（可配置次数）
 * - 外部 AbortSignal 支持（用于取消）
 * - 结构化错误（NetworkError / HttpError / ParseError）
 */
export async function request<T>(url: string, options?: RequestOptions): Promise<T> { ... }
```

错误类型层级：

```typescript
export class DanmakuError extends Error {
    constructor(message: string, public readonly code: ErrorCode, public readonly cause?: unknown) {
        super(message);
    }
}

export enum ErrorCode {
    Network = 'NETWORK',
    Timeout = 'TIMEOUT',
    HttpError = 'HTTP_ERROR',
    ParseError = 'PARSE_ERROR',
    Cancelled = 'CANCELLED',
    NotFound = 'NOT_FOUND',
    InvalidData = 'INVALID_DATA',
}
```

#### 4.3.2 `dandanplay/client.ts` — DanDanPlay API 客户端

**所有函数为纯函数，不访问全局状态，配置通过参数传入。**

```typescript
/** 搜索剧集 */
export async function searchEpisodes(
    apiPrefix: string,
    animeName: string,
    options?: { signal?: AbortSignal }
): Promise<SearchResponse> { ... }

/** 获取弹幕评论 */
export async function getComments(
    apiPrefix: string,
    episodeId: number,
    config: { chConvert: ChConvertMode; withRelated?: boolean },
    options?: { signal?: AbortSignal }
): Promise<DanDanPlayComment[]> { ... }

/** 获取关联弹幕源 */
export async function getRelatedSources(
    apiPrefix: string,
    episodeId: number,
    options?: { signal?: AbortSignal }
): Promise<RelatedSource[]> { ... }

/** 获取外部弹幕源评论 */
export async function getExtComments(
    apiPrefix: string,
    sourceUrl: string,
    config: { chConvert: ChConvertMode },
    options?: { signal?: AbortSignal }
): Promise<DanDanPlayComment[]> { ... }

/** 发送弹幕 */
export async function postComment(
    apiPrefix: string,
    episodeId: number,
    comment: { text: string; time: number; mode: number; color: number },
    token: string,
    options?: { signal?: AbortSignal }
): Promise<void> { ... }

/** 提交关联弹幕源 */
export async function postRelatedSource(
    apiPrefix: string,
    episodeId: number,
    url: string,
    token: string,
    options?: { signal?: AbortSignal }
): Promise<void> { ... }
```

#### 4.3.3 `dandanplay/auth.ts` — 认证管理

```typescript
export class DanDanPlayAuth {
    private status: DanDanPlayStatus;

    constructor(private apiPrefix: string) {
        this.status = Storage.loadDanDanPlayStatus() ?? { isLogin: false, token: '', tokenExpire: 0 };
    }

    get isLoggedIn(): boolean { ... }
    get token(): string { ... }

    /** 登录 */
    async login(account: string, password: string): Promise<boolean> { ... }

    /** 检查 token 是否需要刷新，如需则自动刷新 */
    async refreshIfNeeded(): Promise<void> {
        if (!this.isLoggedIn) return;
        const daysUntilExpire = (this.status.tokenExpire - Date.now()) / 86400000;
        if (daysUntilExpire > 3) return;
        // 刷新 token
    }
}
```

#### 4.3.4 `jellyfin/client.ts` — Jellyfin API 封装

```typescript
/**
 * 安全获取 ApiClient
 * 带空值检查和超时等待
 */
export function getApiClient(): JellyfinApiClient | null {
    return (window as { ApiClient?: JellyfinApiClient }).ApiClient ?? null;
}

/**
 * 获取当前播放的媒体项信息
 * 自动适配 Jellyfin 10.10.0 前后的 API 差异
 */
export async function getCurrentItem(
    isNewJellyfin: boolean,
    itemId: string
): Promise<JellyfinItem | null> {
    const client = getApiClient();
    if (!client) return null;

    if (isNewJellyfin && itemId) {
        const userId = client.getCurrentUserId();
        return client.getItem(userId, itemId);
    } else {
        const sessions = await client.getSessions({ deviceId: client.deviceId() });
        return sessions?.[0]?.NowPlayingItem ?? null;
    }
}
```

#### 4.3.5 `jellyfin/interceptor.ts` — XHR 拦截器

```typescript
/**
 * 安装 PlaybackInfo XHR 拦截器
 *
 * 拦截 XMLHttpRequest 对 PlaybackInfo 端点的响应，
 * 从中提取当前媒体项的 Id。
 *
 * @returns 清理函数（恢复原始 XHR.open）
 */
export function interceptPlaybackInfo(
    onItemId: (id: string) => void
): () => void {
    const originalOpen = XMLHttpRequest.prototype.open;

    XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...args: unknown[]) {
        const urlStr = url.toString();
        if (urlStr.includes('PlaybackInfo')) {
            this.addEventListener('load', function () {
                try {
                    const data = JSON.parse(this.responseText);
                    const id = data?.MediaSources?.[0]?.Id;
                    if (typeof id === 'string' && id.length > 0) {
                        onItemId(id);
                    }
                } catch {
                    logger.warn('interceptor', 'Failed to parse PlaybackInfo response');
                }
            });
        }
        return originalOpen.call(this, method, url, ...args);
    };

    // 返回清理函数
    return () => {
        XMLHttpRequest.prototype.open = originalOpen;
    };
}
```

#### 4.3.6 `episode-matcher.ts` — 剧集匹配策略

```typescript
export interface EpisodeMatcherDeps {
    apiPrefix: string;
    chConvert: ChConvertMode;
    showSelectDialog: (title: string, options: string[], defaultIndex?: number) => Promise<number | null>;
    showInputDialog: (title: string, placeholder: string, defaultValue?: string) => Promise<string | null>;
}

export class EpisodeMatcher {
    constructor(private deps: EpisodeMatcherDeps) {}

    /**
     * 匹配剧集
     *
     * 流程：
     * 1. 检查 localStorage 缓存
     * 2. 搜索 DanDanPlay（animeName）
     * 3. 如果无结果，尝试 OriginalTitle
     * 4. 如果多个结果：
     *    - auto 模式：选第一个
     *    - manual 模式：弹出选择对话框
     * 5. 从选中动画的剧集列表中匹配当前集
     * 6. 缓存结果
     */
    async match(
        item: JellyfinItem,
        mode: 'auto' | 'manual'
    ): Promise<EpisodeInfo | null> { ... }

    /** 通过缓存命中 */
    private getCached(seasonId: string, episodeIndex: number): EpisodeInfo | null { ... }

    /** 搜索并选择动画 */
    private async searchAndSelect(
        name: string,
        mode: 'auto' | 'manual'
    ): Promise<AnimeInfo | null> { ... }

    /** 从动画的剧集列表中匹配 */
    private async selectEpisode(
        anime: AnimeInfo,
        episodeIndex: number,
        mode: 'auto' | 'manual'
    ): Promise<EpisodeInfo | null> { ... }
}
```

#### 4.3.7 `comment-fetcher.ts` — 弹幕获取编排

```typescript
export interface CommentFetcherDeps {
    apiPrefix: string;
    chConvert: ChConvertMode;
    sourceFilter: SourceFilter;
    useXmlDanmaku: boolean;
}

/**
 * 弹幕获取编排器
 *
 * 加载优先级：
 * 1. 如果启用本地 XML：先尝试 Jellyfin 插件 API
 * 2. 本地失败或未启用：使用 DanDanPlay 在线 API
 * 3. 在线 API：主评论 + 关联源评论（按 sourceFilter 过滤）
 *
 * 降级策略：本地 XML 失败 → 自动回退在线源
 */
export class CommentFetcher {
    constructor(private deps: CommentFetcherDeps) {}

    /**
     * 获取弹幕
     * @returns 合并后的原始评论数组
     */
    async fetch(
        episodeId: number,
        jellyfinItemId: string,
        options?: { signal?: AbortSignal }
    ): Promise<RawComment[]> { ... }

    /** 从 DanDanPlay 在线获取 */
    private async fetchOnline(
        episodeId: number,
        options?: { signal?: AbortSignal }
    ): Promise<RawComment[]> { ... }

    /** 从 Jellyfin 插件获取本地 XML 弹幕 */
    private async fetchLocal(
        jellyfinItemId: string,
        options?: { signal?: AbortSignal }
    ): Promise<RawComment[]> {
        const response = await request<string>(
            `${location.origin}/api/danmu/${jellyfinItemId}/raw`,
            { timeout: 5000, retries: 1 }
        );
        return this.parseXmlComments(response);
    }

    /** 解析 XML 弹幕（含 parsererror 检查）*/
    private parseXmlComments(xml: string): RawComment[] {
        const doc = new DOMParser().parseFromString(xml, 'text/xml');
        // 检查解析错误
        if (doc.querySelector('parsererror')) {
            throw new DanmakuError('Invalid XML danmaku data', ErrorCode.ParseError);
        }
        // 解析 <d> 元素
        ...
    }
}
```

---

### 4.4 弹幕模块 — `danmaku/`

#### 4.4.1 `engine.ts` — 渲染引擎封装

```typescript
import Danmaku from 'danmaku';

export interface EngineConfig {
    container: HTMLElement;     // 视频容器
    media: HTMLVideoElement;    // 视频元素
    comments: ProcessedComment[];
    speed: number;
    opacity: number;
    heightRatio: number;
    visible: boolean;
}

/**
 * 弹幕渲染引擎
 *
 * 封装 danmaku npm 包，管理：
 * - Canvas 渲染实例
 * - 弹幕容器 DOM 元素（#danmakuWrapper）
 * - ResizeObserver（debounced）
 * - MutationObserver（仅监听 src 属性）
 */
export class DanmakuEngine {
    private instance: Danmaku | null = null;
    private wrapper: HTMLDivElement | null = null;
    private disposables: (() => void)[] = [];

    /**
     * 初始化引擎
     * 如果已有实例，先销毁旧实例
     */
    init(config: EngineConfig): void {
        this.destroy();

        // 1. 创建容器
        this.wrapper = this.createWrapper(config);
        this.mountWrapper(config.container);

        // 2. 创建 Danmaku 实例
        this.instance = new Danmaku({
            container: this.wrapper,
            media: config.media,
            comments: config.comments,
            engine: 'canvas',
            speed: config.speed,
        });

        if (config.visible) this.instance.show();
        else this.instance.hide();

        // 3. ResizeObserver（debounced 100ms）
        this.setupResizeObserver(config.container);

        // 4. MutationObserver（仅 src 属性）
        this.setupMediaObserver(config.media);
    }

    show(): void { this.instance?.show(); }
    hide(): void { this.instance?.hide(); }
    resize(): void { this.instance?.resize(); }
    emit(comment: ProcessedComment): void { this.instance?.emit(comment); }

    destroy(): void {
        this.disposables.forEach(fn => fn());
        this.disposables = [];
        this.instance?.destroy();
        this.instance = null;
        this.wrapper?.remove();
        this.wrapper = null;
    }

    private createWrapper(config: EngineConfig): HTMLDivElement {
        const wrapper = document.createElement('div');
        wrapper.id = 'danmakuWrapper';
        Object.assign(wrapper.style, {
            position: 'fixed',
            top: '18px',
            width: '100%',
            height: `calc(${config.heightRatio * 100}% - 18px)`,
            opacity: String(config.opacity),
            pointerEvents: 'none',
            zIndex: '1',
        });
        return wrapper;
    }

    private mountWrapper(container: HTMLElement): void {
        const root = document.getElementById('reactRoot') ?? container;
        root.prepend(this.wrapper!);
    }

    private setupResizeObserver(container: HTMLElement): void {
        const resizeOb = new ResizeObserver(
            debounce(() => this.instance?.resize(), 100)
        );
        resizeOb.observe(container);
        this.disposables.push(() => resizeOb.disconnect());
    }

    private setupMediaObserver(media: HTMLVideoElement): void {
        const mutationOb = new MutationObserver((mutations) => {
            for (const m of mutations) {
                if (m.attributeName === 'src') {
                    eventBus.emit('media:source-changed', undefined);
                    break;
                }
            }
        });
        // 关键：attributeFilter 限制为只监听 src
        mutationOb.observe(media, { attributes: true, attributeFilter: ['src'] });
        this.disposables.push(() => mutationOb.disconnect());
    }
}
```

**vs 旧实现的关键修复**：
- MutationObserver 使用 `attributeFilter: ['src']` 而非监听所有属性变化（修复无限重载循环）
- ResizeObserver 回调 debounce 100ms（修复窗口拖动时的高频调用）
- Disposable 模式确保所有 Observer 在 `destroy()` 时断开

#### 4.4.2 `processor.ts` — 弹幕预处理（纯函数）

**所有函数为纯函数，不访问任何全局状态。**

```typescript
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

/**
 * 弹幕预处理管线
 *
 * 步骤：
 * 1. 去重（基于 time+mode+color+text 的 Map 去重）
 * 2. 来源过滤（bilibili/gamer/dandanplay/other）
 * 3. 模式过滤（scroll/top/bottom）
 * 4. 密度限制（基于时间窗口的桶限流）
 * 5. 格式转换（DanDanPlay mode ID → 引擎 mode 字符串，颜色整数 → 十六进制）
 * 6. 时间偏移
 */
export function preProcessDanmaku(
    comments: RawComment[],
    config: ProcessingConfig
): ProcessedComment[] { ... }

/** 去重：基于内容的 Map 去重 */
export function deduplicateComments(comments: RawComment[]): RawComment[] { ... }

/** 来源过滤 */
export function filterBySource(comments: RawComment[], filter: SourceFilter): RawComment[] { ... }

/** 模式过滤 */
export function filterByMode(comments: RawComment[], filter: ModeFilter): RawComment[] { ... }

/** 密度限制 */
export function limitDensity(
    comments: RawComment[],
    limit: DensityLimit,
    bucketSize: number
): RawComment[] { ... }

/** 格式转换 */
export function formatComment(
    comment: RawComment,
    style: { fontSize: number; fontFamily: string; fontOptions: string },
    timeOffset: number
): ProcessedComment { ... }
```

#### 4.4.3 `anti-overlap.ts` — 防重叠算法

```typescript
export interface AntiOverlapConfig {
    containerWidth: number;
    containerHeight: number;
    fontSize: number;
    speed: number;
    fontFamily: string;
    fontOptions: string;
}

/**
 * 防重叠过滤
 *
 * 将弹幕按模式分类，分别在轨道系统中进行碰撞检测：
 * - 滚动弹幕（rtl/ltr）：计算每条弹幕实际速度和轨道占用时间
 * - 固定弹幕（top/bottom）：按固定显示时长分配轨道
 *
 * @returns 过滤后的弹幕数组（移除了会重叠的弹幕）
 */
export function antiOverlapFilter(
    comments: ProcessedComment[],
    config: AntiOverlapConfig
): ProcessedComment[] { ... }

/** 滚动弹幕防重叠 */
export function filterOverlappedScroll(
    sorted: ProcessedComment[],
    config: AntiOverlapConfig,
    measureWidth: (text: string, font: string) => number
): ProcessedComment[] { ... }

/** 固定弹幕防重叠 */
export function filterOverlappedFixed(
    sorted: ProcessedComment[],
    config: AntiOverlapConfig
): ProcessedComment[] { ... }
```

#### 4.4.4 `text-measure.ts` — LRU 缓存文字测量

```typescript
/**
 * 带 LRU 缓存的文字宽度测量
 *
 * 使用离屏 Canvas 2D Context 测量文字像素宽度。
 * LRU 缓存避免重复测量，同时限制最大条目数防止内存泄漏。
 */
export class TextMeasurer {
    private cache: Map<string, number>;
    private context: CanvasRenderingContext2D | null = null;
    private maxCacheSize: number;

    constructor(maxCacheSize = 2000) {
        this.cache = new Map();
        this.maxCacheSize = maxCacheSize;
    }

    /** 懒初始化 Canvas Context（避免模块加载时创建 DOM） */
    private getContext(): CanvasRenderingContext2D {
        if (!this.context) {
            this.context = document.createElement('canvas').getContext('2d')!;
        }
        return this.context;
    }

    /** 测量文字宽度（带 LRU 缓存） */
    measure(text: string, font: string): number {
        const key = `${font}|${text}`;

        if (this.cache.has(key)) {
            // LRU: 移到末尾
            const value = this.cache.get(key)!;
            this.cache.delete(key);
            this.cache.set(key, value);
            return value;
        }

        const ctx = this.getContext();
        ctx.font = font;
        const width = ctx.measureText(text).width;

        // 淘汰最旧条目
        if (this.cache.size >= this.maxCacheSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }

        this.cache.set(key, width);
        return width;
    }

    /** 清空缓存（切换剧集时调用） */
    clear(): void {
        this.cache.clear();
    }
}
```

---

### 4.5 UI 层 — `ui/`

#### 4.5.1 整体 UI 架构

```
Jellyfin 原生播放器 DOM
│
├── .videoPlayerContainer
│   ├── div[data-type='video-osd']
│   │   ├── <video> (播放器)
│   │   └── [Portal] DebugOverlay         ← 调试浮层
│   │
│   └── 播放控制栏
│       ├── .btnPause
│       ├── ... (其他原生按钮)
│       └── [Portal] DanmakuToggle        ← 弹幕开关按钮
│
├── .actionSheet (播放器设置菜单, 动态创建)
│   ├── 画面比例
│   ├── 播放速度
│   └── [Injected] 弹幕设置               ← 注入的菜单项
│
├── [Portal] #danmakuWrapper              ← 弹幕渲染画布
│
└── [Portal] Sidebar                      ← 设置侧边栏 (portal 到 body)
```

**UI 入口设计**：

- **弹幕开关**：一个按钮，Portal 到播放控制栏（`.btnPause` 的兄弟元素位置），图标在 `comment` / `comments_disabled` 之间切换
- **设置入口**：注入到 Jellyfin 播放器设置菜单（`.actionSheet`）中，作为子菜单项。用户点击播放器自带的设置按钮 → 在菜单中看到"弹幕设置"选项 → 点击后打开设置侧边栏

#### 4.5.2 `App.svelte` — 根组件

```svelte
<script lang="ts">
    import { danmakuState } from '../core/state.svelte';
    import { eventBus } from '../core/event-bus';
    import DanmakuToggle from './components/DanmakuToggle.svelte';
    import Sidebar from './components/Sidebar.svelte';
    import DebugOverlay from './components/DebugOverlay.svelte';
    import { portal } from './actions/portal';

    let {
        controlsAnchor,    // .btnPause 元素（用于定位弹幕开关）
        videoContainer,    // 视频 OSD 容器
    }: {
        controlsAnchor: HTMLElement;
        videoContainer: HTMLElement;
    } = $props();

    let sidebarOpen = $state(false);

    // 监听来自 Jellyfin 菜单注入的打开请求
    const unsubscribe = eventBus.on('settings:open', () => {
        sidebarOpen = true;
    });

    // 组件销毁时取消订阅
    $effect(() => {
        return () => unsubscribe();
    });
</script>

<!-- 弹幕开关按钮：Portal 到播放控制栏 -->
<div use:portal={controlsAnchor}>
    <DanmakuToggle />
</div>

<!-- 设置侧边栏：Portal 到 body -->
{#if sidebarOpen}
    <Sidebar onClose={() => sidebarOpen = false} />
{/if}

<!-- 调试浮层：Portal 到视频容器 -->
{#if danmakuState.logSwitch}
    <div use:portal={videoContainer}>
        <DebugOverlay />
    </div>
{/if}
```

#### 4.5.3 `DanmakuToggle.svelte` — 弹幕开关按钮

```svelte
<script lang="ts">
    import { danmakuState } from '../../core/state.svelte';

    function toggle() {
        danmakuState.danmakuSwitch = !danmakuState.danmakuSwitch;
        danmakuState.persist();
    }

    const icon = $derived(danmakuState.danmakuSwitch ? 'comment' : 'comments_disabled');
    const title = $derived(danmakuState.danmakuSwitch ? '关闭弹幕' : '开启弹幕');
</script>

<button class="danmaku-toggle" onclick={toggle} {title} type="button">
    <span class="material-icons">{icon}</span>
</button>

<style>
    .danmaku-toggle {
        background: transparent;
        border: none;
        color: white;
        cursor: pointer;
        padding: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        /* 匹配 Jellyfin 原生按钮尺寸 */
        width: 4.2em;
        height: 4.2em;
    }
    .danmaku-toggle:hover {
        color: #00a4dc;
    }
    .material-icons {
        font-size: 1.72em;
    }
</style>
```

#### 4.5.4 Jellyfin 菜单注入机制

在 `bootstrap.ts` 中通过 MutationObserver 实现：

```typescript
/**
 * 监听 Jellyfin 播放器设置 actionSheet 的创建
 *
 * Jellyfin 点击播放器设置按钮时，会动态创建一个 .actionSheet 元素。
 * 通过检测该元素是否同时包含 [data-id="aspectratio"] 和 [data-id="playbackrate"]
 * 来确认这是播放器设置菜单（而非其他 actionSheet）。
 *
 * 检测到后，在菜单末尾注入"弹幕设置"按钮，点击后通过 eventBus 发送 settings:open 事件。
 */
export function setupMenuInjection(): () => void {
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (!(node instanceof HTMLElement)) continue;

                const actionSheet = node.classList.contains('actionSheet')
                    ? node
                    : node.querySelector('.actionSheet');

                if (!actionSheet) continue;
                if (!actionSheet.querySelector('[data-id="aspectratio"]')) continue;
                if (!actionSheet.querySelector('[data-id="playbackrate"]')) continue;

                injectSettingsMenuItem(actionSheet);
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
}

function injectSettingsMenuItem(actionSheet: HTMLElement): void {
    // 避免重复注入
    if (actionSheet.querySelector('[data-id="danmaku-settings"]')) return;

    const menuItem = document.createElement('button');
    menuItem.setAttribute('data-id', 'danmaku-settings');
    menuItem.className = 'btnDanmakuSettings listItem listItem-button actionSheetMenuItem';
    menuItem.type = 'button';
    menuItem.innerHTML = `
        <span class="actionsheetMenuItemIcon listItemIcon listItemIcon-transparent material-icons">comment</span>
        <div class="listItemBody actionsheetListItemBody">
            <div class="listItemBodyText actionSheetItemText">弹幕设置</div>
        </div>
    `;

    menuItem.addEventListener('click', () => {
        // 关闭 actionSheet
        const closeBtn = actionSheet.closest('.dialogContainer')?.querySelector('.btnCloseActionSheet');
        (closeBtn as HTMLElement)?.click();
        // 打开弹幕设置侧边栏
        eventBus.emit('settings:open', undefined);
    });

    actionSheet.appendChild(menuItem);
}
```

#### 4.5.5 `Sidebar.svelte` — 设置侧边栏

```svelte
<script lang="ts">
    import SettingsTabs from './SettingsTabs.svelte';
    import { danmakuState } from '../../core/state.svelte';
    import { eventBus } from '../../core/event-bus';

    let { onClose }: { onClose: () => void } = $props();

    function handleSave() {
        danmakuState.persist();
        eventBus.emit('settings:saved', undefined);
        onClose();
    }

    function handleCancel() {
        danmakuState.hydrate(); // 恢复上次保存的值
        onClose();
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') handleCancel();
    }

    // 挂载动画
    let visible = $state(false);
    $effect(() => {
        requestAnimationFrame(() => { visible = true; });
        return () => { visible = false; };
    });
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- 背景遮罩 -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="sidebar-backdrop" class:visible onclick={handleCancel}></div>

<!-- 侧边栏面板 -->
<div class="sidebar-panel" class:visible>
    <header class="sidebar-header">
        <h2>弹幕设置</h2>
        <div class="header-actions">
            <button class="btn-save" onclick={handleSave}>保存</button>
            <button class="btn-cancel" onclick={handleCancel}>取消</button>
        </div>
    </header>

    <div class="sidebar-content">
        <SettingsTabs />
    </div>
</div>

<style>
    /* Scoped CSS — 侧边栏滑入动画、毛玻璃背景等 */
    .sidebar-backdrop {
        position: fixed; inset: 0;
        background: rgba(0, 0, 0, 0.5);
        opacity: 0; transition: opacity 0.3s;
        z-index: 9998;
    }
    .sidebar-backdrop.visible { opacity: 1; }

    .sidebar-panel {
        position: fixed; top: 0; right: 0; bottom: 0;
        width: min(450px, 90vw);
        background: rgba(30, 30, 30, 0.95);
        backdrop-filter: blur(10px);
        transform: translateX(100%);
        transition: transform 0.3s ease;
        z-index: 9999;
        display: flex; flex-direction: column;
        color: #e0e0e0;
    }
    .sidebar-panel.visible { transform: translateX(0); }
    /* ... 更多样式 */
</style>
```

#### 4.5.6 `SettingsTabs.svelte` — 标签页容器

```svelte
<script lang="ts">
    import ControlTab from './ControlTab.svelte';
    import StyleTab from './StyleTab.svelte';
    import DisplayTab from './DisplayTab.svelte';
    import FilterTab from './FilterTab.svelte';

    const tabs = [
        { id: 'control', label: '控制功能', component: ControlTab },
        { id: 'style', label: '显示样式', component: StyleTab },
        { id: 'display', label: '显示设置', component: DisplayTab },
        { id: 'filter', label: '过滤设置', component: FilterTab },
    ] as const;

    let activeTab = $state<string>('control');
</script>

<div class="tabs-header">
    {#each tabs as tab}
        <button
            class="tab-btn"
            class:active={activeTab === tab.id}
            onclick={() => activeTab = tab.id}
            type="button"
        >
            {tab.label}
        </button>
    {/each}
</div>

<div class="tabs-content">
    {#each tabs as tab}
        {#if activeTab === tab.id}
            <tab.component />
        {/if}
    {/each}
</div>
```

#### 4.5.7 标签页组件内容

**`ControlTab.svelte`**：
- 弹幕显示开关（toggle switch）
- 调试日志开关
- 弹幕搜索按钮（触发手动搜索匹配）
- 增加弹幕源按钮（输入 URL）
- DanDanPlay 登录（账号/密码）
- CORS 代理地址输入
- 自定义 API 地址输入

**`StyleTab.svelte`**：
- 透明度滑块（0 ~ 1，步进 0.1）
- 滚动速度滑块（50 ~ 600）
- 字体大小滑块（10 ~ 60）
- 显示区域比例滑块（0.1 ~ 1.0）
- 字体选择输入框
- 字体附加选项输入框（如 bold）

**`DisplayTab.svelte`**：
- 弹幕密度限制（无限制 / 低 / 中 / 高）
- 防重叠开关
- 简繁转换选择（无 / 简体 / 繁体）
- 本地 XML 弹幕开关
- 时间偏移输入框

**`FilterTab.svelte`**：
- 来源过滤复选框组（Bilibili / Gamer / DanDanPlay / 其他）
- 模式过滤复选框组（滚动 / 顶部 / 底部）

#### 4.5.8 `InputDialog.svelte` / `SelectDialog.svelte` — 对话框

提供 Promise 化的命令式调用接口：

```typescript
// 供 services 层调用的命令式 API
export function showInputDialog(
    title: string,
    placeholder: string,
    defaultValue?: string
): Promise<string | null> {
    return new Promise((resolve) => {
        const target = document.createElement('div');
        document.body.appendChild(target);
        const app = mount(InputDialog, {
            target,
            props: {
                title, placeholder, defaultValue,
                onConfirm: (value: string) => { cleanup(); resolve(value); },
                onCancel: () => { cleanup(); resolve(null); },
            },
        });
        function cleanup() { unmount(app); target.remove(); }
    });
}
```

#### 4.5.9 `actions/portal.ts` — Portal Action

```typescript
import { mount, unmount } from 'svelte';

/**
 * Svelte action: 将子元素传送到指定 DOM 节点
 *
 * 用法: <div use:portal={targetElement}>...</div>
 * 效果: div 的子元素将被移动到 targetElement 中
 */
export function portal(node: HTMLElement, target: HTMLElement) {
    target.appendChild(node);

    return {
        update(newTarget: HTMLElement) {
            newTarget.appendChild(node);
        },
        destroy() {
            node.remove();
        },
    };
}
```

---

### 4.6 类型定义 — `types/`

#### 4.6.1 `index.ts` — 公共业务类型

```typescript
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
    tokenExpire: number;       // Unix 时间戳
    userName?: string;
}

/** Jellyfin 媒体项（简化） */
export interface JellyfinItem {
    Id: string;
    Name: string;
    SeriesName?: string;
    SeasonId?: string;
    IndexNumber?: number;       // 集数
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
    episodes: EpisodeItem[];
}

/** 剧集列表项 */
export interface EpisodeItem {
    episodeId: number;
    episodeTitle: string;
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
}
```

#### 4.6.2 `danmaku-engine.d.ts` — Danmaku 库类型声明

```typescript
declare module 'danmaku' {
    interface DanmakuOptions {
        container: HTMLElement;
        media: HTMLMediaElement;
        comments?: CommentData[];
        engine?: 'canvas' | 'dom';
        speed?: number;
    }

    interface CommentData {
        text: string;
        mode: 'rtl' | 'ltr' | 'top' | 'bottom';
        time: number;
        style?: {
            font?: string;
            fillStyle?: string;
            strokeStyle?: string;
            lineWidth?: number;
        };
    }

    class Danmaku {
        constructor(options: DanmakuOptions);
        show(): void;
        hide(): void;
        clear(): void;
        destroy(): void;
        resize(): void;
        emit(comment: CommentData): void;
        readonly comments: CommentData[];
    }

    export default Danmaku;
}
```

#### 4.6.3 `jellyfin.d.ts` — Jellyfin 全局类型

```typescript
interface JellyfinApiClient {
    getCurrentUserId(): string;
    deviceId(): string;
    _appVersion: string;
    getItem(userId: string, itemId: string): Promise<JellyfinItem>;
    getSessions(options: { deviceId: string }): Promise<JellyfinSession[]>;
}

interface JellyfinSession {
    NowPlayingItem?: JellyfinItem;
}

declare global {
    interface Window {
        ApiClient?: JellyfinApiClient;
    }
}
```

---

### 4.7 工具模块 — `utils/`

#### 4.7.1 `dom.ts`

```typescript
/**
 * 等待 DOM 元素出现
 *
 * @param selector - CSS 选择器
 * @param options.timeout - 超时时间（ms），默认 10000
 * @param options.signal - 外部取消信号
 * @returns Promise<HTMLElement>，超时则 reject
 */
export function waitForElement(
    selector: string,
    options?: { timeout?: number; signal?: AbortSignal }
): Promise<HTMLElement> { ... }

/**
 * debounce
 * @returns 带 cancel() 方法的 debounced 函数
 */
export function debounce<T extends (...args: unknown[]) => void>(
    fn: T,
    delay: number
): T & { cancel: () => void } { ... }

/**
 * throttle
 */
export function throttle<T extends (...args: unknown[]) => void>(
    fn: T,
    interval: number
): T { ... }
```

#### 4.7.2 `version.ts`

```typescript
/**
 * 语义版本比较
 * @returns -1 (v1 < v2), 0 (v1 == v2), 1 (v1 > v2)
 */
export function compareVersions(v1: string, v2: string): -1 | 0 | 1 { ... }
```

#### 4.7.3 `color.ts`

```typescript
/** 整数颜色值转 #rrggbb 十六进制字符串 */
export function intToHex(color: number): string { ... }

/** 判断颜色是否接近黑色（用于设置描边颜色） */
export function isDarkColor(color: number): boolean { ... }
```

#### 4.7.4 `disposable.ts`

```typescript
/**
 * 资源清理收集器
 *
 * 收集多个清理函数，统一执行。
 * 用于管理 Observer、Listener、Interval 等资源。
 */
export class DisposableStore {
    private disposables: (() => void)[] = [];

    /** 添加清理函数 */
    add(dispose: () => void): void {
        this.disposables.push(dispose);
    }

    /** 添加 addEventListener 并自动返回 removeEventListener */
    addEventlistener(
        target: EventTarget,
        event: string,
        handler: EventListener,
        options?: AddEventListenerOptions
    ): void {
        target.addEventListener(event, handler, options);
        this.disposables.push(() => target.removeEventListener(event, handler, options));
    }

    /** 添加 setInterval 并自动返回 clearInterval */
    addInterval(handler: () => void, interval: number): void {
        const id = setInterval(handler, interval);
        this.disposables.push(() => clearInterval(id));
    }

    /** 执行所有清理函数 */
    dispose(): void {
        this.disposables.forEach(fn => fn());
        this.disposables = [];
    }
}
```

---

## 5. 数据流

### 5.1 弹幕加载流程

```
视频播放器创建
    │
    ▼
observePlayerLifecycle 触发 onPlayerCreated
    │
    ├─ mountApp()            → Svelte UI 挂载
    ├─ setupMenuInjection()  → actionSheet 菜单注入
    │
    ▼
loadDanmaku(reason: 'init')
    │
    ├─ danmakuState.loading = true
    │
    ├─ [useXmlDanmaku?]
    │   ├─ YES → CommentFetcher.fetchLocal()
    │   │         ├─ 成功 → 使用本地弹幕
    │   │         └─ 失败 → 回退在线
    │   └─ NO  → 直接在线
    │
    ├─ EpisodeMatcher.match(item, 'auto')
    │   ├─ 检查缓存 → 命中则返回
    │   ├─ searchEpisodes(animeName)
    │   │   └─ 无结果 → searchEpisodes(OriginalTitle)
    │   ├─ 选择动画（自动取第一个）
    │   ├─ 匹配集数
    │   └─ 缓存结果
    │
    ├─ CommentFetcher.fetchOnline(episodeId)
    │   ├─ getComments(episodeId)       → 主弹幕
    │   ├─ getRelatedSources(episodeId) → 关联源 URL 列表
    │   ├─ 按 sourceFilter 过滤 URL
    │   ├─ getExtComments(url) × N      → 外部源弹幕
    │   └─ 合并所有弹幕
    │
    ├─ DanmakuEngine.init({
    │       comments: processedComments,
    │       speed, opacity, heightRatio, ...
    │   })
    │   ├─ preProcessDanmaku()  → 去重/过滤/格式化
    │   ├─ antiOverlapFilter()  → 防重叠（如果启用）
    │   ├─ new Danmaku(...)     → 创建渲染实例
    │   └─ 设置 Observer
    │
    └─ danmakuState.loading = false
```

### 5.2 设置变更流程

```
用户打开 Jellyfin 设置菜单
    │
    ▼
点击 "弹幕设置" 菜单项
    │
    ▼
eventBus.emit('settings:open')
    │
    ▼
App.svelte: sidebarOpen = true → 渲染 Sidebar
    │
    ▼
用户修改设置（滑块、开关等）
    │  （直接绑定到 danmakuState 的 $state 属性）
    │  （UI 通过 Svelte 响应式自动更新预览）
    │
    ├─ 点击"保存"
    │   ├─ danmakuState.persist() → debounced 写入 localStorage
    │   ├─ eventBus.emit('settings:saved')
    │   │   └─ bootstrap 监听 → 触发 DanmakuEngine 重新初始化
    │   └─ 关闭 Sidebar
    │
    └─ 点击"取消" / ESC
        ├─ danmakuState.hydrate() → 从 localStorage 恢复上次值
        └─ 关闭 Sidebar
```

---

## 6. 错误处理策略

### 6.1 网络请求

| 场景 | 策略 |
|------|------|
| 请求超时 | AbortController 超时 10s，抛出 `DanmakuError(Timeout)` |
| 网络不可达 | 指数退避重试（最多 3 次：1s → 2s → 4s） |
| HTTP 4xx | 不重试，抛出 `DanmakuError(HttpError)` |
| HTTP 5xx | 重试，抛出 `DanmakuError(HttpError)` |
| JSON 解析失败 | 抛出 `DanmakuError(ParseError)` |
| 请求被取消 | 抛出 `DanmakuError(Cancelled)`，上层静默处理 |

### 6.2 降级策略

| 场景 | 降级方案 |
|------|----------|
| 本地 XML API 不可用 | 自动回退 DanDanPlay 在线源 |
| DanDanPlay API 不可用 | 显示错误提示，不阻塞视频播放 |
| CORS 代理不可用 | 显示错误提示，建议用户检查 CORS 配置 |
| `window.ApiClient` 不存在 | 带超时等待（5s），超时后 logger.error 并停止 |
| localStorage 数据损坏 | Valibot 校验失败，重置为默认值，logger.warn |
| `waitForElement` 超时 | reject 后上层 catch，不阻塞其他功能 |
| 剧集匹配失败 | 返回 null，DebugOverlay 显示"未匹配到弹幕" |

### 6.3 错误展示

- **用户可见错误**：通过 `DebugOverlay` 显示简要信息（如"弹幕加载失败"）
- **开发者调试**：`logger` 记录完整错误栈，`logSwitch` 开启时在 overlay 显示详情
- **静默错误**：AbortSignal 取消不展示任何信息

---

## 7. 性能优化

### 7.1 事件驱动替代轮询

| 原实现 | 新实现 |
|--------|--------|
| `setInterval(initUI, 200)` 轮询控制栏 | `MutationObserver` + `waitForElement` 事件驱动 |
| `setInterval(initListener, 200)` 轮询视频 | `MutationObserver` 监听 `.videoPlayerContainer` 增删 |
| `setInterval(refreshToken, 60000)` 永不清理 | `DisposableStore` 管理，视频销毁时清理 |

### 7.2 缓存策略

| 缓存 | 策略 | 容量 |
|------|------|------|
| 文字宽度测量 | LRU 缓存 | 2000 条，切集时清空 |
| 剧集匹配结果 | localStorage 持久缓存 | 按 seasonId + episodeIndex 索引 |
| 配置持久化 | debounce 300ms 批量写入 | 单个 JSON 对象 |

### 7.3 Observer 优化

- `ResizeObserver` 回调 debounce 100ms
- `MutationObserver` 使用 `attributeFilter: ['src']` 精确过滤（修复无限循环 bug）
- 所有 Observer 在组件/引擎销毁时 `disconnect()`

### 7.4 智能重载判断

在 `loadDanmaku` 中检查：如果当前 `episodeId` 未变化且不是强制刷新，跳过重新加载。避免 UI 重新挂载时触发不必要的 API 请求。

---

## 8. 测试策略

### 8.1 测试基础设施

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
    plugins: [svelte({ hot: false })],
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./tests/setup.ts'],
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: ['src/types/**', 'src/**/*.d.ts'],
        },
    },
});
```

### 8.2 测试优先级

| 优先级 | 模块 | 测试类型 | 理由 |
|--------|------|----------|------|
| P0 | `danmaku/processor.ts` | 单元测试 | 核心数据处理，纯函数，易测 |
| P0 | `danmaku/anti-overlap.ts` | 单元测试 | 复杂算法，边界情况多 |
| P0 | `core/storage.ts` | 单元测试 | 数据持久化正确性关键 |
| P0 | `core/config.ts` | 单元测试 | 验证逻辑覆盖所有边界 |
| P1 | `services/episode-matcher.ts` | 单元测试 | mock API 客户端，测匹配策略 |
| P1 | `services/http.ts` | 单元测试 | 重试/超时逻辑 |
| P1 | `utils/*` | 单元测试 | 工具函数 |
| P2 | `core/event-bus.ts` | 单元测试 | 订阅/发布/清理 |
| P2 | UI 组件 | 组件测试 | 交互正确性 |

### 8.3 可测试性设计

确保可测试性的关键手段：
- **纯函数**：`processor.ts`、`anti-overlap.ts` 中的处理函数不依赖全局状态
- **依赖注入**：`EpisodeMatcher`、`CommentFetcher` 通过构造函数接收依赖
- **接口抽象**：HTTP 客户端可 mock，Storage 可用内存实现替代
- **Canvas Context**：`TextMeasurer` 延迟创建，测试时可注入 mock context

---

## 9. 构建配置

### 9.1 独立 JS 构建 — `build/vite.standalone.config.ts`

```typescript
export default defineConfig({
    plugins: [svelte()],
    build: {
        outDir: 'dist',
        lib: {
            entry: 'src/main.ts',
            name: 'JellyfinDanmaku',
            fileName: 'ede.min',
            formats: ['iife'],
        },
        rollupOptions: {
            output: { inlineDynamicImports: true },
        },
        minify: 'esbuild',
    },
});
```

产物：`dist/ede.min.js`（单文件 IIFE），通过 `<script>` 标签加载。

### 9.2 用户脚本构建 — `build/vite.userscript.config.ts`

```typescript
import monkey from 'vite-plugin-monkey';

export default defineConfig({
    plugins: [
        svelte(),
        monkey({
            entry: 'src/main.ts',
            userscript: {
                name: 'Jellyfin Danmaku',
                namespace: 'jellyfin-danmaku',
                version: '2.0.0',
                description: 'Jellyfin 弹幕插件',
                author: 'RyoLee, Izumiko',
                match: [
                    '*://*/web/index.html',
                    '*://*/web/',
                    '*://*/web/#/*',
                ],
                icon: 'https://github.com/nicedayzhu/jellyfin-danmaku/raw/jellyfin/Newlogo.ico',
            },
        }),
    ],
});
```

产物：`dist/ede.user.js`（带 Tampermonkey 元数据头）。

### 9.3 NPM Scripts

```json
{
    "scripts": {
        "dev": "vite --config build/vite.userscript.config.ts",
        "build": "vite build --config build/vite.standalone.config.ts",
        "build:userscript": "vite build --config build/vite.userscript.config.ts",
        "build:all": "npm run build && npm run build:userscript",
        "test": "vitest run",
        "test:watch": "vitest",
        "test:coverage": "vitest run --coverage",
        "check": "svelte-check --tsconfig ./tsconfig.app.json",
        "typecheck": "tsc --noEmit",
        "format": "prettier --write 'src/**/*.{ts,svelte}'",
        "lint": "eslint 'src/**/*.{ts,svelte}'"
    }
}
```

---

## 10. 实施路线

### Phase 1：基础架构（预计 2-3 天）

1. 初始化项目：package.json、tsconfig.json (strict)、Vite 配置、Vitest 配置
2. 实现 `types/` 全部类型定义 + 类型声明文件
3. 实现 `core/config.ts`（常量 + Valibot schema + 验证函数）
4. 实现 `core/storage.ts`（含 schema 校验）
5. 实现 `core/event-bus.ts`
6. 实现 `core/logger.ts`
7. 实现 `utils/`（dom、version、color、disposable）
8. 编写 core + utils 单元测试

**交付物**：可运行的测试套件，核心层全部就绪。

### Phase 2：服务层 + 弹幕引擎（预计 3-4 天）

1. 实现 `services/http.ts`（统一 HTTP 层）
2. 实现 `services/jellyfin/`（client + interceptor）
3. 实现 `services/dandanplay/`（client + auth + types）
4. 实现 `services/episode-matcher.ts`
5. 实现 `services/comment-fetcher.ts`
6. 实现 `danmaku/text-measure.ts`（LRU 缓存）
7. 实现 `danmaku/processor.ts`（纯函数预处理）
8. 实现 `danmaku/anti-overlap.ts`
9. 实现 `danmaku/engine.ts`
10. 编写 services + danmaku 单元测试

**交付物**：全部业务逻辑就绪，可通过单元测试验证正确性。

### Phase 3：UI 组件（预计 3-4 天）

1. 实现 `ui/actions/portal.ts`
2. 实现 `DanmakuToggle.svelte`
3. 实现 `InputDialog.svelte` + `SelectDialog.svelte`
4. 实现 `Sidebar.svelte` + `SettingsTabs.svelte`
5. 实现四个标签页组件（ControlTab、StyleTab、DisplayTab、FilterTab）
6. 实现 `DebugOverlay.svelte`
7. 实现 `App.svelte`（根组件 + portal 编排）
8. CSS 变量和基础样式

**交付物**：完整 UI，可独立预览。

### Phase 4：集成与生命周期（预计 2-3 天）

1. 实现 `main.ts`（入口守卫）
2. 实现 `bootstrap.ts`（完整生命周期编排）
3. 实现 Jellyfin 菜单注入（`setupMenuInjection`）
4. 连接所有模块：视频检测 → 弹幕加载 → UI 挂载 → 清理
5. 双构建目标验证
6. 在实际 Jellyfin 环境中端到端测试

**交付物**：功能完整的插件，可在 Jellyfin 中运行。

### Phase 5：打磨（预计 1-2 天）

1. 全链路错误处理验证和边界情况修复
2. 性能分析和优化
3. 补全测试覆盖率
4. 更新 CI/CD（GitHub Actions）
5. 更新 README

**交付物**：生产就绪的 v2.0。

---

## 11. 与现有 `ts` 分支的关系

本方案是全新架构设计，但可以**参考复用** `ts` 分支中以下实现：

| 可复用 | 来源 | 调整 |
|--------|------|------|
| Vite 双构建配置 | `build/*.config.ts` | 升级 Vite 版本，调整输出路径 |
| 类型定义 | `types/index.ts` | 扩展为 boolean 替代 0/1，增加枚举 |
| 配置验证逻辑 | `config.ts` | 改用 Valibot schema |
| 防重叠算法 | `processor.ts` | 提取为独立纯函数模块 |
| Svelte 组件 UI 结构 | `Sidebar.svelte` | 拆分为多个子组件 |
| 工具函数 | `utils/index.ts` | 拆分为独立文件，增加超时/abort |

**不复用**的部分（需重写）：

- `state.svelte.ts`（改为 `$state` rune 响应式）
- `main.ts`（从轮询改为事件驱动）
- `engine.ts`（修复 MutationObserver bug，配置注入）
- API 客户端（从耦合全局状态改为纯函数）
- 菜单注入逻辑（从手动 DOM 改为 eventBus 联动）
