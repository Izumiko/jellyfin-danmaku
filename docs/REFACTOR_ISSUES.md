# Jellyfin-Danmaku 重构问题跟踪

## 修复状态: ✅ 全部完成

- 类型检查: ✅ 通过 (`npm run typecheck`)
- 单元测试: ✅ 57 个测试全部通过 (`npm test`)
- 测试覆盖率: 8 个测试文件，57 个测试

---

## 严重问题 (P0) - 已修复

### 1. ✅ 播放器生命周期管理完全缺失
- **文件**: `src/bootstrap.ts`
- **问题**: bootstrap() 只执行一次，没有检测播放器创建/销毁/切集
- **影响**: 离开视频页再进入无弹幕；切集不更新弹幕
- **修复**: 重写 bootstrap.ts，添加 `observePlayerLifecycle()` 使用 MutationObserver 检测 `.videoPlayerContainer` 的添加/移除。播放器销毁时调用 `cleanupPlayer()` 清理所有资源（引擎、UI、事件监听）。视频源变更时自动延迟 2s 重载弹幕。

### 2. ✅ 弹幕开关按钮完全失效
- **文件**: `src/ui/components/DanmakuToggle.svelte`
- **问题**: 只切换本地 visible prop，未绑定 danmakuState 和引擎
- **影响**: 点击按钮无反应，弹幕无法开关
- **修复**: 绑定到 `danmakuState.danmakuSwitch`，点击时更新状态、持久化到 localStorage、调用 `danmakuEngine.show()` / `hide()`。

### 3. ✅ 弹幕预处理参数全部硬编码
- **文件**: `src/danmaku/engine.ts`
- **问题**: sourceFilter/modeFilter/densityLimit/fontSize 等全部硬编码
- **影响**: 用户所有个性化设置不生效
- **修复**: `engine.init()` 中从 `danmakuState` 读取所有配置传入 `preProcessDanmaku()` 和 `antiOverlapFilter()`。在 `state.svelte.ts` 和 `types/index.ts` 中添加了缺失的 `curEpOffset` 字段。

### 4. ✅ CORS 代理配置逻辑错误
- **文件**: `src/core/state.svelte.ts`
- **问题**: effectiveApiPrefix 直接返回 API 地址，未拼接 CORS 代理
- **影响**: 浏览器直接请求被 CORS 拒绝
- **修复**: 恢复 `corsProxy + apiPrefix` 拼接逻辑：`effectiveApiPrefix` = `customApiPrefix` 或 `effectiveCorsProxy + 'https://api.dandanplay.net'`。与原版 ede.js 的 `getApiPrefix()` 行为一致。

### 5. ✅ 设置侧边栏是空壳
- **文件**: `src/ui/components/Sidebar.svelte`
- **问题**: 仅显示"正在开发中"，无任何实际控件
- **影响**: 用户无法修改任何设置
- **修复**: 实现完整的 4 标签页侧边栏（控制功能/显示样式/显示设置/过滤设置），包含：
  - 弹幕开关、日志开关
  - 透明度/速度/字体大小/区域比例滑块
  - 字体/字体选项输入框
  - 密度限制下拉框、防重叠开关
  - 简繁转换、本地 XML 弹幕开关
  - 弹幕偏移时间输入
  - 来源过滤复选框（Bilibili/巴哈姆特/弹弹Play/其他）
  - 模式过滤复选框（滚动/顶部/底部）
  - CORS 代理/API 地址输入
  - 搜索弹幕按钮

---

## 重要问题 (P1) - 已修复

### 6. ✅ DebugOverlay 未实现
- **文件**: `src/ui/components/DebugOverlay.svelte`
- **问题**: 空组件，无法显示日志
- **影响**: 用户无法查看运行状态
- **修复**: 实现完整的日志浮层，每 500ms 刷新显示最近 50 条日志。支持按级别着色（DEBUG/INFO/WARN/ERROR），提供清空按钮。在 `bootstrap.ts` 中挂载到视频容器。

### 7. ✅ 缺少旧版 localStorage 配置迁移
- **文件**: `src/core/storage.ts`
- **问题**: 新版使用新 key，旧版设置全部丢失
- **影响**: 升级用户设置重置
- **修复**: 在 `loadConfig()` 中优先读取新版配置，如果不存在则调用 `migrateLegacyConfig()` 从旧版独立 key（`danmakuSwitch`, `danmakuopacity`, `chConvert` 等 16 个 key）读取并转换格式。支持旧版 number/boolean/bitmask 到新版 boolean/object/enum 的转换。

### 8. ✅ 菜单注入样式不匹配
- **文件**: `src/bootstrap.ts`
- **问题**: 缺少 emby-button 等原生样式类
- **影响**: 菜单项样式可能与 Jellyfin 不一致
- **修复**: 添加 `emby-button` 和 `listItem` 等完整样式类。优化插入位置（在"循环模式"或"播放统计"之前插入）。

---

## 架构改进 (P2) - 已修复

### 9. ✅ 缺少核心模块测试
- **文件**: `tests/unit/`
- **问题**: 仅有 3 个基础测试，核心逻辑无覆盖
- **修复**: 新增 5 个测试文件，38 个新测试：
  - `tests/unit/danmaku/processor.test.ts` - 去重、来源过滤、模式过滤、密度限制、格式转换
  - `tests/unit/danmaku/anti-overlap.test.ts` - 滚动/固定弹幕防重叠
  - `tests/unit/services/http.test.ts` - GET/POST、超时、重试、取消、HTTP 错误
  - `tests/unit/services/episode-matcher.test.ts` - 缓存命中、搜索、自动选择、回退 OriginalTitle
  - `tests/unit/services/comment-fetcher.test.ts` - 在线获取、本地 XML、降级、关联源过滤

### 10. ✅ 视频源变更事件未监听
- **文件**: `src/bootstrap.ts`
- **问题**: engine emit 'media:source-changed' 但 bootstrap 未订阅
- **修复**: 在 `bootstrap()` 中订阅 `media:source-changed` 事件，切集时延迟 2 秒后自动重载弹幕。

---

## 关键修改文件清单

| 文件 | 修改类型 | 说明 |
|------|---------|------|
| `src/bootstrap.ts` | 重写 | 完整的播放器生命周期管理 |
| `src/danmaku/engine.ts` | 修改 | 使用 danmakuState 配置 |
| `src/ui/components/DanmakuToggle.svelte` | 重写 | 绑定状态和引擎 |
| `src/ui/components/Sidebar.svelte` | 重写 | 完整的设置界面 |
| `src/ui/components/DebugOverlay.svelte` | 重写 | 日志浮层 |
| `src/core/state.svelte.ts` | 修改 | 添加 curEpOffset，修复 CORS 代理 |
| `src/core/storage.ts` | 修改 | 旧版配置迁移 |
| `src/core/config.ts` | 修改 | 添加 curEpOffset schema |
| `src/types/index.ts` | 修改 | 添加 curEpOffset 字段 |
| `tests/unit/danmaku/processor.test.ts` | 新增 | 弹幕预处理测试 |
| `tests/unit/danmaku/anti-overlap.test.ts` | 新增 | 防重叠测试 |
| `tests/unit/services/http.test.ts` | 新增 | HTTP 客户端测试 |
| `tests/unit/services/episode-matcher.test.ts` | 新增 | 剧集匹配测试 |
| `tests/unit/services/comment-fetcher.test.ts` | 新增 | 弹幕获取测试 |
