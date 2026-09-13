# 剧集匹配缓存迁 IndexedDB

日期：2026-09-13  
基线：`typescript` 分支

## 1. 背景

当前 `Storage` 全部走 localStorage：

| 数据 | key | 去向 |
|------|-----|------|
| 用户设置 | `jellyfin_danmaku_config` | **仍 localStorage**（小、启动同步、Valibot） |
| DanDanPlay 登录 | `jellyfin_danmaku_ddplay_status` | **仍 localStorage**（小、启动同步；IDB 无 XSS 优势） |
| 剧集匹配 | `jellyfin_danmaku_episode_${seasonId}_${episodeIndex}` | **迁 IndexedDB**（按集一条、30 天 TTL、会持续增长） |

不在本轮：弹幕正文缓存、HostAdapter、换存储库。

## 2. 目标

匹配缓存进 IndexedDB，配置和登录不动。IDB 失败时当缓存未命中，播放路径不中断。旧 localStorage 匹配 key 启动时迁一次。

成功标准：

1. `getEpisodeCache` / `setEpisodeCache` 读写 IDB，热路径行为与现在一致（含 30 天过期）。
2. 启动迁移 `jellyfin_danmaku_episode_*` → IDB 后删除旧 key。
3. IDB 抛错或不可用：get 返回 `null`，set 只 log。
4. 现有 matcher 测试改为 async + `fake-indexeddb` 后仍通过。

## 3. 架构

```
Storage.loadConfig / saveConfig / ddplay_status     → localStorage（同步）
Storage.getEpisodeCache / setEpisodeCache           → IndexedDB（async）
  └─ src/core/idb.ts  原生 IDB 单例，无运行时依赖
```

库：`jellyfin-danmaku`，version `1`。  
object store：`episode-cache`。  
keyPath：`id`，值为 `${seasonId}:${episodeIndex}`。  
索引：`timestamp`（给 sweep 用）。

记录形状（存盘多一个 `id`，对外仍是 `CachedEpisode`）：

```ts
type EpisodeCacheRecord = CachedEpisode & { id: string };
// CachedEpisode: episodeId, animeTitle, episodeTitle, timestamp
```

## 4. 模块

### 4.1 `src/core/idb.ts`

- `openDanmakuDb(): Promise<IDBDatabase>`：模块级 Promise 单例；`onupgradeneeded` 建 store + `timestamp` 索引。
- `idbGet<T>(store, key)` / `idbPut(store, value)` / `idbDelete(store, key)` / `idbClear(store)`
- `idbEachByIndex(store, index, iterate)`：供 sweep。
- 不导出给 UI。请求失败 reject，由 Storage 吞掉。

### 4.2 `Storage` episode API

```ts
static async getEpisodeCache(seasonId: string, episodeIndex: number): Promise<CachedEpisode | null>
static async setEpisodeCache(seasonId: string, episodeIndex: number, data: CachedEpisode): Promise<void>
static async migrateEpisodeCacheFromLocalStorage(): Promise<void>
static async sweepExpiredEpisodeCache(maxAgeMs = 30 * 24 * 60 * 60 * 1000): Promise<void>
```

- get：拼 `id`，读记录；无记录或 `Date.now() - timestamp > maxAge` → delete 后 `null`。剥掉 `id` 再返回。
- set：put `{ id, ...data }`。
- migrate：扫描 `localStorage` 中 `jellyfin_danmaku_episode_` 前缀；合法 JSON 写入 IDB；成功后 `removeItem`。坏 JSON 删 key。整段 try/catch，失败只 warn。
- sweep：走 `timestamp` 索引，过期 delete。
- `clear()`：继续清 localStorage 前缀，并 `idbClear('episode-cache')`（async，`clear` 改为 `async` 或内部 fire-and-forget；**改为 async**，测试 await）。

无 `episodeIndex` 的旧重载（`getEpisodeCache(seasonId)`）若代码里已不用则删掉；matcher 只走 `(seasonId, index)`。

### 4.3 调用方

- `EpisodeMatcher.match`：`await Storage.getEpisodeCache` / `setEpisodeCache`。auto 命中逻辑不变。
- `DanmakuRuntime.start`（或 `bootstrap` 一次）：`await Storage.migrateEpisodeCacheFromLocalStorage()` 然后 `await Storage.sweepExpiredEpisodeCache()`。失败只 log。放 Runtime.start 开头，保证第一次 match 前迁移完成。

### 4.4 失败降级

| 情况 | 行为 |
|------|------|
| 隐私模式 / IDB 打开失败 | get→null，set no-op + warn |
| put QuotaExceeded | warn，不抛 |
| get 解析异常 | 删该条，返回 null |
| migrate 部分失败 | 已成功的 key 已删，失败的留下次再试 |

## 5. 测试

devDependency：`fake-indexeddb`。`tests/setup.ts` 在 jsdom 里安装。

- get/set 往返
- 过期 get 返回 null 且记录被删
- migrate：写入两条旧 key，调用 migrate 后 IDB 可读、localStorage 无这些 key
- 打开失败：mock `openDanmakuDb` reject，get 返回 null
- matcher 缓存命中测试改为 await（现有 `vi.mock Storage` 仍可用，不必真打 IDB）

## 6. 明确不做

- 配置、token 进 IDB
- 缓存弹幕 JSON
- Dexie / `idb` npm
- 旧版 ede.js 的 `_episode_id_rel_*` 迁移（本轮只迁 `jellyfin_danmaku_episode_*`）

## 7. 文件清单

新建：`src/core/idb.ts`，`tests/unit/core/idb-episode-cache.test.ts`  
修改：`src/core/storage.ts`，`src/services/episode-matcher.ts`，`src/runtime.ts`，`tests/setup.ts`，`tests/unit/core/storage.test.ts`，`package.json`（dev: fake-indexeddb）
