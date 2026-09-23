# ede.js → TypeScript 功能等价状态

> 更新：2026-09-23  
> 基线：`jellyfin/ede.js`（3769 行）→ `typescript/src/**`  
> 本轮仅做源码对照、实现与静态检查；**未执行 Vitest、typecheck、svelte-check、lint 或 build**，运行验证由维护者后续完成。

## 当前结论

TypeScript 分支的主体重构已经从“架构搭好但存在用户可感知缺口”推进到“原版主要功能均已有对应实现，进入实机兼容验证阶段”。

早期 `PROGRESS.md` 中的“100% 完成/生产就绪”结论不应再作为验证依据。后续应以本文件和实际 Jellyfin 环境测试结果为准。

## 功能对照

| ede.js 能力 | TypeScript 实现 | 状态 |
|---|---|---|
| 弹幕显示/隐藏 | `DanmakuToggle.svelte` + Runtime visibility event | 已实现 |
| 设置侧边栏 | `Sidebar.svelte` | 已实现 |
| 设置保存/取消 | `state.svelte.ts` + `Storage` | 已实现，取消可恢复即时开关 |
| 日志显示 | `logger.ts` + `DebugOverlay.svelte` | 已实现，连续重复日志可合并 |
| 自定义 CORS / API | `DanmakuState.effectiveApiPrefix` | 已实现 |
| 自动剧集匹配 | `EpisodeMatcher` | 已实现 |
| 手动搜索/选择动画及剧集 | Promise dialogs + `EpisodeMatcher` | 已实现 |
| Series OriginalTitle 回退 | Jellyfin series metadata | 已实现 |
| 旧剧集匹配记忆 | IndexedDB | 已实现 |
| ede.js 旧 localStorage 匹配缓存迁移 | `Storage.migrateEpisodeCacheFromLocalStorage` | 已实现 |
| 逐集时间偏移 | IndexedDB offset store | 已实现 |
| DanDanPlay 在线弹幕 | `CommentFetcher` / client | 已实现 |
| 关联弹幕源 | related + extcomment | 已实现 |
| 手动增加弹幕源 | Sidebar → Runtime | 已实现 |
| Bilibili/Gamer/DDP/其他来源过滤 | `processor.ts` | 已按 ede.js 分类语义对齐 |
| 模式过滤 | `processor.ts` | 已实现 |
| 密度限制 | `processor.ts` | 已按 ede.js 桶算法对齐 |
| 防重叠 | `anti-overlap.ts` | 已按 ede.js 轨道释放算法对齐 |
| 字体/字号/速度/透明度/高度 | Engine + Sidebar | 已实现，范围按原版设置 UI 对齐 |
| 简繁转换参数 | DanDanPlay API 参数 | 已实现 |
| Jellyfin 本地 XML | `jellyfin/danmaku.ts` | 已实现 |
| 本地 XML 优先、在线降级 | Runtime | 已按 ede.js 顺序对齐，不依赖 DDP 匹配 |
| Jellyfin 子路径 XML URL | pathname rewrite | 已实现 |
| DanDanPlay 登录 | Auth + Sidebar/Send dialog | 已实现 |
| Token 续期 | GET `/api/v2/login/renew` | 已实现 |
| 旧 `ddplayStatus` 迁移 | Storage | 已实现 |
| 发送弹幕 API | `postComment` | 已实现 |
| 发送弹幕交互 | `SendDanmaku.svelte` | 已补齐并接入控制栏 |
| 发送成功即时显示 | Runtime → Engine.emit | 已实现 |
| Jellyfin 新旧版本当前 Item 获取 | Jellyfin client | 已实现 |
| PlaybackInfo ItemId 捕获 | XHR interceptor | 已实现 |
| 播放器创建/销毁 | MutationObserver | 已实现并处理 DOM replacement race |
| 切集重载 | PlaybackInfo + media observer | 已实现 |
| Resize | ResizeObserver | 已实现 |
| Font Awesome 播放器主题图标 | Toggle / Send | 已补齐 |
| 设置菜单注入 | bootstrap | 已实现 |
| 独立 `#danmakuCtr` 控制容器 | bootstrap | 已按 ede.js 结构恢复 |

## 本轮额外修复的高风险问题

1. **本地 XML 被在线匹配错误阻断**：现在先读取本地 XML；只有本地没有数据时才进行 DanDanPlay 匹配。
2. **密度等级方向及算法错误**：恢复原版 `(9 - level * 2) * lines`、滚动/固定时间桶逻辑。
3. **来源识别错误**：无方括号前缀的评论恢复为 DanDanPlay 原生来源，未知方括号前缀归入其他来源。
4. **关联源重复抓取 Bilibili bangumi**：主请求已有 Bilibili 评论时不再重复抓同类 bangumi 源。
5. **旧版匹配缓存没有真正迁移**：补迁移 `_anime_id_rel_*`、`_anime_name_rel_*`、`_episode_id_rel_*` 和 offset。
6. **发送弹幕链路缺失**：补 UI、登录、POST、错误反馈和即时显示。
7. **API HTTP 200 业务错误被当成功**：DanDanPlay GET/POST 均检查 `errorCode`。
8. **GET 强制 Content-Type 导致额外 CORS 预检**：只有存在 JSON body 时才设置 `Content-Type`。
9. **AbortSignal 监听器泄漏**：组合 signal 在请求结束后主动移除监听。
10. **自定义 API 修改后 Auth 仍使用旧地址**：登录/续期端点现在随配置同步。
11. **播放器 DOM 替换竞争条件**：旧异步初始化可失效，remove+add 同一批 mutation 能正确重建。
12. **对话框事件穿透播放器**：输入/选择/发送对话框阻止播放器鼠标、触摸、滚轮及热键事件。
13. **配置迁移静默截断旧参数**：速度 20–600、字号 8–80、高度 0–1 与原版 UI 可选范围对齐。
14. **损坏配置/登录态进入运行时**：持久化配置逐字段清洗，过期/非法 token 自动清理。

## 建议实机优先验证

1. Jellyfin 新版和旧版各测试一次：进入视频、退出视频、再次进入、连续切集。
2. 本地 XML：根路径安装与 `/jellyfin/web/` 子路径安装各测试一次，并断网验证不依赖 DanDanPlay。
3. 在线匹配：自动匹配、手动搜索、OriginalTitle 回退、第二季/特殊集数偏移。
4. 来源过滤：Bilibili、Gamer、DanDanPlay 原生、其他第三方四类分别开关。
5. 密度限制和防重叠：低/中/高等级及顶部/底部/滚动混合场景。
6. 设置：即时弹幕开关、取消恢复、日志开关、0 高度、20 速度、80 字号。
7. 自定义 CORS/API：保存后重新搜索、登录、加源、发送弹幕。
8. 登录/续期：有效 token、已过期 token、登录失败、API `errorCode != 0`。
9. 发送弹幕：滚动/顶部/底部、发送失败保留窗口、成功后当前时间即时出现。
10. Firefox / Chromium / 移动端触控：侧边栏、对话框、控制栏按钮是否触发播放器手势。

## 暂不计入 ede.js 功能等价的内容

`HostAdapter`、MockHost、Studio、自研 Canvas 等来自其他实验分支/后续架构设想，并不是 `jellyfin/ede.js` 已有用户功能，因此不作为本轮 ede.js → TypeScript 功能缺口。
