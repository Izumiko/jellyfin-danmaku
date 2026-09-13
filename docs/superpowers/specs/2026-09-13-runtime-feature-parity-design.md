# Runtime 抽取与原版功能补齐

日期：2026-09-13  
基线：`typescript` 分支（Svelte 5 + TypeScript）  
参考：`ede.js` 1.61、`another-version/`（Vue 初版，只取交互与协议，不换框架）

## 1. 背景

当前分支把 `ede.js` 拆成了模块、测试和双产物构建，但 `PROGRESS.md` 的「100% 完成」不成立。对照原版，用户可感知缺口主要是：手动搜索无对话框、不能增加弹幕源、登录未接线、DanDanPlay `p` 字段解析错误、本地 XML 在子路径安装下失效。

`another-version` 用 Vue 实现了 Host 抽象、Studio、Promise 对话框和手动匹配，但测试/HTTP/OSD/版本检测更弱。本轮不换 Vue、不迁 Studio、不自研 canvas。

| 来源 | 本轮采纳 |
|------|----------|
| 当前分支 | Svelte UI、Valibot、HTTP 超时重试、OSD 开关、DebugOverlay、JF 版本检测、`danmaku` npm、现有测试 |
| another-version | Promise 对话框、手动匹配流程、增加弹幕源、XML 子路径、`Host` 思路仅作后续预留 |
| ede.js | `p` 四段格式、登录/续期协议、`postRelatedSource` 载荷、`第N话` 与季数搜索 |

## 2. 目标

抽出 `DanmakuRuntime`，把弹幕业务流程从 `bootstrap.ts` 挪走，并补齐原版已有的搜索 / 加源 / 登录路径，同时修掉会让在线弹幕显示错误的协议 bug。

成功标准：

1. 自动播放路径：拦截 item → 匹配 → 拉取 → 渲染，行为与现网一致且 `p` 颜色/来源正确。
2. Sidebar「搜索弹幕」弹出输入/选择对话框，可覆盖缓存后重载。
3. Sidebar「增加弹幕源」按 URL 拉 `extcomment` 并合并重绘；已登录则 POST related。
4. Sidebar 可登录/登出 DanDanPlay；启动时按原版规则续期。
5. Jellyfin 装在 `/web/` 子路径时本地 XML URL 正确。
6. 切集或销毁会 abort 进行中的 load；同 `episodeId` 的 refresh 不重复拉取。

## 3. 架构

```
main.ts
  └─ bootstrap.ts
        生命周期：ApiClient / 版本 / XHR / 播放器 Observer / 菜单注入 / 挂载 UI
        播放器创建 → new DanmakuRuntime + load('init')
        播放器销毁 → runtime.destroy()
        └─ DanmakuRuntime
              match / fetch / engine / searchManual / addSource / login
```

- `bootstrap.ts` 不再直接调 `EpisodeMatcher` / `CommentFetcher` / `danmakuEngine.init`。
- UI 仍分开 mount（Toggle / Sidebar / DebugOverlay）。不引入 `App.svelte`，不抽 `HostAdapter`。
- 对话框用命令式 Promise API，供 Runtime 和 matcher 调用，不依赖某个 Svelte 根组件。

## 4. 模块

### 4.1 `src/runtime.ts`（新建）

`DanmakuRuntime` 持有：

- `EpisodeMatcher`、`CommentFetcher`、`DanDanPlayAuth`、对 `danmakuEngine` 的调用
- 当前 `AbortController`、上次成功的 `episodeId`
- 当前合并后的 `RawComment[]`（给 `addSource` 追加）

公开方法：

| 方法 | 行为 |
|------|------|
| `load(reason)` | `init` / `refresh` / `settings-changed`：自动匹配。`search` 走 `searchManual`。 |
| `searchManual()` | 忽略缓存；Input 动画名 → Select 动画 → Select 集；写缓存；再 fetch。 |
| `addSource(url)` | `getExtComments` 转 `RawComment` 后追加、去重、重绘；已登录则 `postRelatedSource`。无当前 episode 则记日志并返回。 |
| `login(account, password)` / `logout()` | 调 Auth；失败只记日志，不关侧边栏。 |
| `destroy()` | abort load、销毁引擎、清空引用。 |

构造时 `auth.refreshIfNeeded()`。`apiPrefix` 一律用 `danmakuState.effectiveApiPrefix`。

`load` 规则：

1. 新 JF：最多等 2s（10×200ms）直到 `danmakuState.itemId` 有值，超时仍继续用 sessions 回退。
2. `getCurrentItem` 失败 → 日志，不抛。
3. `reason !== 'search'` 且新 `episodeId` 等于上次成功值 → return。
4. 新 load 先 `abort()` 上一次。
5. XML 开启则本地优先，失败降级在线（现有 fetcher 行为保留）。

### 4.2 对话框

新建：

- `src/ui/components/InputDialog.svelte`
- `src/ui/components/SelectDialog.svelte`
- `src/ui/dialogs.ts`

`dialogs.ts`：

```ts
showInputDialog(title, placeholder, defaultValue?): Promise<string | null>
showSelectDialog(title, options, defaultIndex?): Promise<number | null>
```

实现：在 `document.body` 上临时 mount，确认/取消/Escape 后 unmount 并 `resolve`。取消或 Escape → `null`，当作 noop，不清当前弹幕。输入框 `keydown` `stopPropagation`，避免 Jellyfin 热键抢走按键。

Matcher 依赖改为必填（不再 optional）：

```ts
showInputDialog: typeof showInputDialog
showSelectDialog: typeof showSelectDialog
```

### 4.3 剧集匹配 `episode-matcher.ts`

对齐 `ede.js` / `another-version/src/api/match.ts`：

- **auto**：先读 `Storage.getEpisodeCache`；未命中再搜索。
- **manual**：不读 episode 缓存。先 `showInputDialog` 确认动画名（默认 `SeriesName \|\| Name`，季数 `ParentIndexNumber > 1` 时名称后追加季数）。再搜索，`showSelectDialog` 选动画、选集。写缓存。
- 搜索无结果且 item 有 `OriginalTitle` → 再搜一次。
- 自动选集：用 `第(\d+)话` 解析列表首集偏移（与原版一致）；找不到再用 `IndexNumber - 1` 下标。同时接受 `第(\d+)集` 作为次要正则，避免中文集标题漏配。
- 取消任一对话框 → `null`，Runtime 不重载。

### 4.4 评论协议

DanDanPlay 在线 `p` 为四段：`time,mode,color,user`（`ede.js` 2034–2083）。

`convertDanDanPlayComment` 必须改为：

- `time = parts[0]`
- `modeId = parts[1]`
- `color = parts[2]`
- `user = parts[3]` 原样保留（`[BiliBili]` / `[Gamer]` / 弹弹用户），禁止再包 `[DanDanPlay]`

Bilibili XML（jellyfin-plugin-danmu）仍是八段：`stime,type,fontSize,color,date,pool,sender,dbid`。`parseXmlDanmaku` 保持 `color = parts[3]`，并把 `user` 设为 `parts[6]`（字符串，不要 `map(Number)`）。转换结果与在线四段在 `RawComment` 上统一。

关联源：

- `RelatedSource.shift` 加到该源每条 `time`。
- `extcomment` 用 `Promise.all` 并行，单个失败只 warn。
- `withRelated=true` 的主评论已含部分第三方；额外 `extcomment` 仍按 URL 的 `sourceFilter` 拉（保持现有 fetcher 逻辑，不移植 another-version 的 bitmask / hasBili 特判）。去重交给 preprocess。

`postRelatedSource` 载荷：`{ episodeId, url, shift: 0 }`。  
`postComment` 载荷改为 `{ time, mode, color, comment }`（字段名 `comment` 不是 `text`）。本轮不做发送 UI。

### 4.5 本地 XML URL

```
origin + pathname.replace(/\/web\/(index\.html)?/, '/api/danmu/') + itemId + '/raw'
```

禁止写死 `` `${location.origin}/api/danmu/${id}/raw` ``。

### 4.6 Auth 与存储

- 登录：POST `/api/v2/login`，检查 `errorCode === 0`，`tokenExpire` 用响应的 `tokenExpireTime`（可能是日期字符串，与原版一样 `new Date(...).getTime()`）。
- 续期：`GET` `/api/v2/login/renew`（不是 POST），Bearer token；成功写 `token` + `tokenExpireTime`。过期已过则视为未登录；距过期 > 3 天不续期。续期失败调用 `logout()`。
- `Storage.loadDanDanPlayStatus`：先读 `jellyfin_danmaku_ddplay_status`；没有则读旧 key `ddplayStatus`，校验后写入新 key。

### 4.7 Sidebar

控制页补齐并接到 Runtime（通过现有 `eventBus` 或 bootstrap 注入的回调，二选一：**用 eventBus**，避免 Sidebar 直接 import Runtime 单例）：

| UI | 事件 / 行为 |
|----|-------------|
| 搜索弹幕 | `eventBus.emit('danmaku:reload', { reason: 'search' })`（已有，Runtime 改为走 manual） |
| 增加弹幕源 | InputDialog 要 URL → Runtime.addSource |
| 登录 | 两个输入框 + 按钮；已登录显示用户名和登出 |
| 保存 | 现有 persist + `settings-changed` 重载 |

`eventBus` 增补（均无 payload 歧义）：

| 事件 | payload | 订阅方 |
|------|---------|--------|
| `danmaku:add-source` | `{ url: string }` | Runtime.addSource |
| `auth:login` | `{ account: string; password: string }` | Runtime.login |
| `auth:logout` | `undefined` | Runtime.logout |

登录态用 `danmakuState` 的非持久化字段 `ddplayLoggedIn` / `ddplayUserName`，供 Sidebar 响应式显示。Runtime 在 login / logout / refreshIfNeeded 后更新这两项。

增加弹幕源：Sidebar 自己调 `showInputDialog` 拿到 URL，再 emit `danmaku:add-source`。搜索对话框仍由 Runtime/matcher 弹出（手动匹配有多步）。

增加弹幕源按钮放在控制页搜索按钮旁。登录失败不关闭侧边栏。

Sidebar 关闭/取消必须 `unmount` 组件再移除 DOM（修当前泄漏）。

### 4.8 bootstrap 收缩

保留：等 ApiClient、版本检测、XHR 拦截、`observePlayerLifecycle`、菜单注入、mount Toggle/Sidebar/Overlay。

播放器创建：构造 Runtime，`load('init')`。  
`danmaku:reload` / `media:source-changed` 转给当前 Runtime。  
播放器销毁：`runtime.destroy()`，并正确 unmount 三个 UI。

`playerDisposables` 要么真正登记本次播放器的订阅，要么删掉空壳，禁止再分配后从不 `add`。

## 5. 错误处理

| 情况 | 行为 |
|------|------|
| HTTP 超时/失败 | 现有 `http.ts` 重试；最终失败日志 + 空弹幕或保留上一批（load 失败不 `engine.destroy` 除非本次已成功拿到新数据） |
| 匹配失败 / 无结果 | 日志，引擎不强制清空 |
| 对话框取消 | noop |
| XML 失败 | warn，降级在线 |
| 加源失败 | warn，保留已有弹幕 |
| 登录失败 | 日志；可用 `alert` 与原版一致，不关 Sidebar |
| 切集 / destroy | abort 当前 fetch |

## 6. 测试

补测试，不测 Svelte 对话框 DOM：

- `convertDanDanPlayComment`：四段 `p`，颜色取 `parts[2]`，user 前缀保留。
- `parseXmlDanmaku` / XML URL 拼接：子路径 `/jellyfin/web/index.html`。
- matcher：auto 缓存命中；manual 不读缓存；对话框取消返回 null；`第N话` 偏移；季数>1 搜索名。
- fetcher：`shift` 加到 time；单个 ext 失败不影响主评论。
- auth：从 `ddplayStatus` 迁移；renew 走 GET。
- runtime（可抽纯函数测 abort/skip-same-episode，不必上 jsdom 引擎）。

## 7. 明确不做

- HostAdapter / MockHost / Studio
- 自研 canvas 或替换 `danmaku` npm
- `App.svelte`、顶栏匹配标题、Font Awesome 图标分支
- 密度/防重叠算法与原版逐行对齐
- 发送弹幕 UI
- 旧版 episode cache key（`_episode_id_rel_*`）迁移（登录 key 要迁，匹配缓存本轮不迁）

## 8. 文件清单

新建：`src/runtime.ts`、`src/ui/dialogs.ts`、`src/ui/components/InputDialog.svelte`、`src/ui/components/SelectDialog.svelte`，以及对应 `tests/unit/**`。

修改：`bootstrap.ts`、`episode-matcher.ts`、`comment-fetcher.ts`、`dandanplay/client.ts`、`dandanplay/auth.ts`、`jellyfin/danmaku.ts`、`core/storage.ts`、`ui/components/Sidebar.svelte`、必要时 `types/index.ts`。
