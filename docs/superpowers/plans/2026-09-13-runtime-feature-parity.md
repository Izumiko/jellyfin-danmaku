# Runtime 抽取与原版功能补齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从 `bootstrap.ts` 抽出 `DanmakuRuntime`，补齐手动搜索 / 增加弹幕源 / 登录，并修掉 DanDanPlay `p` 解析、XML 子路径、Auth 协议与原版不一致的问题。

**Architecture:** `bootstrap.ts` 只负责播放器生命周期和 UI 挂载。`DanmakuRuntime` 拥有 match → fetch → engine、搜索、加源、登录，并通过 `eventBus` 接收 Sidebar 动作。对话框是命令式 Promise API。继续用 Svelte 5 + `danmaku` npm。`another-version/` 只读，禁止 `git add`。

**Tech Stack:** TypeScript strict、Svelte 5、Vitest + jsdom、现有 `http.ts` / Valibot / Vite。

**Spec:** `docs/superpowers/specs/2026-09-13-runtime-feature-parity-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| `src/types/index.ts` | `DanDanPlayComment.p` 注释改为四段；必要时补登录响应类型 |
| `src/services/dandanplay/client.ts` | 四段 `p` 解析；`postComment` / `postRelatedSource` 载荷 |
| `src/services/jellyfin/danmaku.ts` | 导出 `buildLocalDanmakuUrl`；XML `user=parts[6]` |
| `src/core/storage.ts` | 从 `ddplayStatus` 迁移登录态 |
| `src/services/dandanplay/auth.ts` | `errorCode`；`tokenExpireTime`；GET renew |
| `src/core/event-bus.ts` | `danmaku:add-source` / `auth:login` / `auth:logout` |
| `src/core/state.svelte.ts` | 非持久化 `ddplayLoggedIn` / `ddplayUserName` |
| `src/ui/dialogs.ts` | Promise 对话框入口 |
| `src/ui/components/InputDialog.svelte` | 文本输入 |
| `src/ui/components/SelectDialog.svelte` | 列表选择 |
| `src/services/episode-matcher.ts` | 手动对话框、跳过缓存、季数、`第N话` |
| `src/services/comment-fetcher.ts` | `shift`、并行 extcomment |
| `src/runtime.ts` | 弹幕流程编排 |
| `src/bootstrap.ts` | 缩成生命周期；构造/销毁 Runtime |
| `src/ui/components/Sidebar.svelte` | 加源、登录；关闭时由 bootstrap unmount |

测试文件按任务列在各 Task 的 Test 行。不要提交 `another-version/`。

---

### Task 1: 四段 `p` 解析

**Files:**
- Modify: `src/types/index.ts:169-174`
- Modify: `src/services/dandanplay/client.ts:145-159`
- Modify: `tests/unit/services/comment-fetcher.test.ts`（mock 改为四段，或改用真实 `convertDanDanPlayComment`）
- Test: `tests/unit/services/dandanplay-convert.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/services/dandanplay-convert.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { convertDanDanPlayComment } from '@/services/dandanplay/client';

describe('convertDanDanPlayComment', () => {
    it('parses DanDanPlay 4-field p as time,mode,color,user', () => {
        const raw = convertDanDanPlayComment({
            cid: 1,
            p: '12.5,1,16777215,[BiliBili]abc',
            m: 'hello',
        });
        expect(raw).toEqual({
            time: 12.5,
            modeId: 1,
            color: 16777215,
            text: 'hello',
            user: '[BiliBili]abc',
        });
    });

    it('does not wrap user with [DanDanPlay]', () => {
        const raw = convertDanDanPlayComment({
            cid: 2,
            p: '1,5,255,plain-user',
            m: 'top',
        });
        expect(raw.user).toBe('plain-user');
        expect(raw.color).toBe(255);
        expect(raw.modeId).toBe(5);
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/services/dandanplay-convert.test.ts`

Expected: FAIL（`color` 会是 `NaN` 或错位，`user` 带 `[DanDanPlay]`）

- [ ] **Step 3: 最小实现**

`src/types/index.ts` 中 `DanDanPlayComment.p` 注释改为 `"time,mode,color,user"`。

`convertDanDanPlayComment` 改为：

```ts
export function convertDanDanPlayComment(comment: DanDanPlayComment): RawComment {
    const parts = comment.p.split(',');
    return {
        time: parseFloat(parts[0] ?? '0'),
        modeId: parseInt(parts[1] ?? '1', 10),
        color: parseInt(parts[2] ?? '16777215', 10),
        text: comment.m,
        user: parts[3] || undefined,
    };
}
```

`comment-fetcher.test.ts`：删掉 `convertDanDanPlayComment` 的 vi.mock 实现，改为：

```ts
vi.mock('@/services/dandanplay/client', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/services/dandanplay/client')>();
    return {
        ...actual,
        getComments: vi.fn(),
        getRelatedSources: vi.fn(),
        getExtComments: vi.fn(),
    };
});
```

`createDanDanPlayComment` 改为四段：

```ts
const createDanDanPlayComment = (time: number, text: string) => ({
    cid: 1,
    p: `${time},1,16777215,user1`,
    m: text,
});
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/services/dandanplay-convert.test.ts tests/unit/services/comment-fetcher.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/unit/services/dandanplay-convert.test.ts tests/unit/services/comment-fetcher.test.ts src/services/dandanplay/client.ts src/types/index.ts
git commit -m "fix: parse DanDanPlay comment p as time,mode,color,user"
```

---

### Task 2: XML 子路径 URL 与 sender

**Files:**
- Modify: `src/services/jellyfin/danmaku.ts`
- Test: `tests/unit/services/jellyfin-danmaku.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/services/jellyfin-danmaku.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildLocalDanmakuUrl, getLocalXmlDanmaku } from '@/services/jellyfin/danmaku';

describe('buildLocalDanmakuUrl', () => {
    it('rewrites /web/index.html subpath', () => {
        expect(
            buildLocalDanmakuUrl('https://jf.example', '/jellyfin/web/index.html', 'abc'),
        ).toBe('https://jf.example/jellyfin/api/danmu/abc/raw');
    });

    it('rewrites /web/ without index.html', () => {
        expect(
            buildLocalDanmakuUrl('https://jf.example', '/web/', 'abc'),
        ).toBe('https://jf.example/api/danmu/abc/raw');
    });
});

describe('getLocalXmlDanmaku', () => {
    beforeEach(() => {
        vi.stubGlobal('location', {
            origin: 'https://jf.example',
            pathname: '/jellyfin/web/index.html',
        });
    });

    it('parses 8-field XML p and keeps sender as user', async () => {
        const xml = `<?xml version="1.0"?><i><d p="392.0,1,25,16777215,0,0,[BiliBili]e686,1723">hi</d></i>`;
        vi.stubGlobal(
            'fetch',
            vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    headers: new Headers({ 'content-type': 'text/xml' }),
                    text: () => Promise.resolve(xml),
                    json: () => Promise.reject(new Error('not json')),
                } as Response),
            ),
        );

        const comments = await getLocalXmlDanmaku('item-1');
        expect(comments).toEqual([
            {
                time: 392,
                modeId: 1,
                color: 16777215,
                text: 'hi',
                user: '[BiliBili]e686',
            },
        ]);
    });
});
```

若 `http.get` 因 content-type 走 json 失败，测试改为 mock `@/services/http` 的 `get` 返回 xml 字符串，只断言 `parse` 结果。此时把 `parseXmlDanmaku` 一并导出，测试直接喂 XML，URL 测试只测 `buildLocalDanmakuUrl`。

优先方案（更稳）：导出 `parseXmlDanmaku`，XML 解析测试不打网络：

```ts
import { buildLocalDanmakuUrl, parseXmlDanmaku } from '@/services/jellyfin/danmaku';

it('parses 8-field XML p and keeps sender as user', () => {
    const xml = `<?xml version="1.0"?><i><d p="392.0,1,25,16777215,0,0,[BiliBili]e686,1723">hi</d></i>`;
    expect(parseXmlDanmaku(xml)[0]).toMatchObject({
        time: 392,
        modeId: 1,
        color: 16777215,
        text: 'hi',
        user: '[BiliBili]e686',
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/services/jellyfin-danmaku.test.ts`

Expected: FAIL（`buildLocalDanmakuUrl` / `parseXmlDanmaku` 未导出）

- [ ] **Step 3: 实现**

`src/services/jellyfin/danmaku.ts`：

```ts
export function buildLocalDanmakuUrl(origin: string, pathname: string, jellyfinItemId: string): string {
    const path = pathname.replace(/\/web\/(index\.html)?/, '/api/danmu/');
    return `${origin}${path}${jellyfinItemId}/raw`;
}

export function parseXmlDanmaku(xml: string): RawComment[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');
    if (doc.querySelector('parsererror')) {
        throw new Error('Invalid XML danmaku data');
    }
    const comments: RawComment[] = [];
    for (const element of Array.from(doc.querySelectorAll('d'))) {
        const p = element.getAttribute('p');
        const text = element.textContent;
        if (!p || !text) continue;
        const parts = p.split(',');
        if (parts.length < 4) continue;
        const time = parseFloat(parts[0] ?? '');
        const modeId = parseInt(parts[1] ?? '', 10);
        const color = parseInt(parts[3] ?? '', 10);
        if (isNaN(time) || isNaN(modeId) || isNaN(color)) continue;
        comments.push({
            time,
            modeId,
            color,
            text: text.trim(),
            user: parts[6] || undefined,
        });
    }
    return comments;
}

export async function getLocalXmlDanmaku(jellyfinItemId: string, options?: { signal?: AbortSignal }): Promise<RawComment[]> {
    const url = buildLocalDanmakuUrl(location.origin, location.pathname, jellyfinItemId);
    const xml = await get<string>(url, { timeout: 5000, retries: 1, signal: options?.signal });
    return parseXmlDanmaku(xml);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/services/jellyfin-danmaku.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/jellyfin/danmaku.ts tests/unit/services/jellyfin-danmaku.test.ts
git commit -m "fix: local XML URL subpath and sender field"
```

---

### Task 3: Auth 协议与旧 key 迁移

**Files:**
- Modify: `src/core/storage.ts:94-114`
- Modify: `src/services/dandanplay/auth.ts`
- Test: `tests/unit/core/storage.test.ts`（追加）
- Test: `tests/unit/services/auth.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/unit/core/storage.test.ts` 追加：

```ts
describe('DanDanPlay status', () => {
    it('migrates legacy ddplayStatus key', () => {
        localStorage.setItem(
            'ddplayStatus',
            JSON.stringify({
                isLogin: true,
                token: 'tok',
                tokenExpire: '2099-01-01T00:00:00Z',
                userName: 'alice',
            }),
        );
        const status = Storage.loadDanDanPlayStatus();
        expect(status?.isLogin).toBe(true);
        expect(status?.token).toBe('tok');
        expect(status?.userName).toBe('alice');
        expect(status?.tokenExpire).toBeGreaterThan(Date.now());
        expect(localStorage.getItem('jellyfin_danmaku_ddplay_status')).toBeTruthy();
    });
});
```

创建 `tests/unit/services/auth.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DanDanPlayAuth } from '@/services/dandanplay/auth';
import { get, post } from '@/services/http';

vi.mock('@/services/http', () => ({
    get: vi.fn(),
    post: vi.fn(),
}));

describe('DanDanPlayAuth', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
    });

    it('rejects login when errorCode is not 0', async () => {
        vi.mocked(post).mockResolvedValue({
            errorCode: 1,
            errorMessage: 'bad password',
        });
        const auth = new DanDanPlayAuth('https://api.example.com');
        await expect(auth.login('a', 'b')).resolves.toBe(false);
        expect(auth.isLoggedIn).toBe(false);
    });

    it('stores tokenExpireTime from login', async () => {
        vi.mocked(post).mockResolvedValue({
            errorCode: 0,
            token: 't1',
            tokenExpireTime: '2099-01-01T00:00:00Z',
            userName: 'bob',
        });
        const auth = new DanDanPlayAuth('https://api.example.com');
        await expect(auth.login('a', 'b')).resolves.toBe(true);
        expect(auth.token).toBe('t1');
        expect(auth.isLoggedIn).toBe(true);
    });

    it('renews with GET /login/renew', async () => {
        const soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
        localStorage.setItem(
            'jellyfin_danmaku_ddplay_status',
            JSON.stringify({ isLogin: true, token: 'old', tokenExpire: Date.now() + 2 * 86400000 }),
        );
        vi.mocked(get).mockResolvedValue({
            errorCode: 0,
            token: 'new',
            tokenExpireTime: soon,
        });
        const auth = new DanDanPlayAuth('https://api.example.com');
        await auth.refreshIfNeeded();
        expect(get).toHaveBeenCalledWith(
            'https://api.example.com/api/v2/login/renew',
            expect.objectContaining({
                headers: { Authorization: 'Bearer old' },
            }),
        );
        expect(post).not.toHaveBeenCalled();
        expect(auth.token).toBe('new');
    });
});
```

注意：`refreshIfNeeded` 在构造时已从 Storage 读入 status。测试里先写 localStorage 再 `new DanDanPlayAuth`。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/core/storage.test.ts tests/unit/services/auth.test.ts`

Expected: FAIL（无迁移；login 不看 errorCode；renew 走 POST）

- [ ] **Step 3: 实现**

`Storage.loadDanDanPlayStatus`：

```ts
static loadDanDanPlayStatus(): DanDanPlayStatus | null {
    try {
        const raw =
            localStorage.getItem(`${STORAGE_PREFIX}ddplay_status`) ??
            localStorage.getItem('ddplayStatus');
        if (!raw) return null;
        const parsed = JSON.parse(raw) as {
            isLogin?: boolean;
            token?: string;
            tokenExpire?: number | string;
            userName?: string;
        };
        const expire =
            typeof parsed.tokenExpire === 'number'
                ? parsed.tokenExpire
                : parsed.tokenExpire
                  ? new Date(parsed.tokenExpire).getTime()
                  : 0;
        const status: DanDanPlayStatus = {
            isLogin: Boolean(parsed.isLogin),
            token: parsed.token ?? '',
            tokenExpire: Number.isFinite(expire) ? expire : 0,
            userName: parsed.userName,
        };
        localStorage.setItem(`${STORAGE_PREFIX}ddplay_status`, JSON.stringify(status));
        return status;
    } catch (error) {
        console.error('[Storage] Failed to load DanDanPlay status:', error);
        return null;
    }
}
```

`auth.ts` login 响应检查 `errorCode === 0`，过期用 `tokenExpireTime`。`refreshIfNeeded` 改 `get`（从 `http` 同时 import `get`）：

```ts
const response = await get<{ errorCode: number; token: string; tokenExpireTime: string }>(
    url,
    { headers: { Authorization: `Bearer ${this.status.token}` } },
);
if (response.errorCode !== 0) {
    this.logout();
    return;
}
```

登录：

```ts
const response = await post<{
    errorCode: number;
    errorMessage?: string;
    token: string;
    tokenExpireTime: string;
    userName: string;
}>(url, { userName: account, password });
if (response.errorCode !== 0) {
    logger.error('auth', 'Login failed', response.errorMessage);
    return false;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/core/storage.test.ts tests/unit/services/auth.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/storage.ts src/services/dandanplay/auth.ts tests/unit/core/storage.test.ts tests/unit/services/auth.test.ts
git commit -m "fix: DanDanPlay login renew GET and legacy status migration"
```

---

### Task 4: POST 载荷对齐原版

**Files:**
- Modify: `src/services/dandanplay/client.ts:88-143`
- Test: `tests/unit/services/dandanplay-post.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { postComment, postRelatedSource } from '@/services/dandanplay/client';
import { post } from '@/services/http';

vi.mock('@/services/http', () => ({
    get: vi.fn(),
    post: vi.fn(),
}));

describe('dandanplay posts', () => {
    beforeEach(() => vi.clearAllMocks());

    it('posts comment with comment field not text', async () => {
        vi.mocked(post).mockResolvedValue(undefined);
        await postComment('https://api.example.com', 9, { text: 'hi', time: 1, mode: 1, color: 0 }, 'tok');
        expect(post).toHaveBeenCalledWith(
            'https://api.example.com/api/v2/comment/9',
            { time: 1, mode: 1, color: 0, comment: 'hi' },
            expect.objectContaining({ headers: { Authorization: 'Bearer tok' } }),
        );
    });

    it('posts related source with episodeId url shift', async () => {
        vi.mocked(post).mockResolvedValue(undefined);
        await postRelatedSource('https://api.example.com', 9, 'https://bilibili.com/x', 'tok');
        expect(post).toHaveBeenCalledWith(
            'https://api.example.com/api/v2/related/9',
            { episodeId: 9, url: 'https://bilibili.com/x', shift: 0 },
            expect.objectContaining({ headers: { Authorization: 'Bearer tok' } }),
        );
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/services/dandanplay-post.test.ts`

Expected: FAIL（body 含 `text` / 缺少 `shift`）

- [ ] **Step 3: 改载荷**

`postComment` body：`{ time: comment.time, mode: comment.mode, color: comment.color, comment: comment.text }`  
`postRelatedSource` body：`{ episodeId, url, shift: 0 }`

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/services/dandanplay-post.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/dandanplay/client.ts tests/unit/services/dandanplay-post.test.ts
git commit -m "fix: align comment and related-source POST bodies with ede.js"
```

---

### Task 5: eventBus 与登录态字段

**Files:**
- Modify: `src/core/event-bus.ts:1-16`
- Modify: `src/core/state.svelte.ts:30-34`
- Modify: `tests/unit/core/event-bus.test.ts`

- [ ] **Step 1: 写失败测试**

在 `event-bus.test.ts` 追加：

```ts
it('emits danmaku:add-source and auth events', () => {
    const sources: string[] = [];
    const unsub = eventBus.on('danmaku:add-source', (data) => sources.push(data.url));
    eventBus.emit('danmaku:add-source', { url: 'https://example.com' });
    expect(sources).toEqual(['https://example.com']);
    unsub();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/core/event-bus.test.ts`

Expected: FAIL（类型/事件不存在）

- [ ] **Step 3: 实现**

`EventMap` 增加：

```ts
'danmaku:add-source': { url: string };
'auth:login': { account: string; password: string };
'auth:logout': undefined;
```

`DanmakuState` 运行时字段（不要写入 `toConfig`）：

```ts
ddplayLoggedIn = $state(false);
ddplayUserName = $state('');
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/core/event-bus.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/event-bus.ts src/core/state.svelte.ts tests/unit/core/event-bus.test.ts
git commit -m "feat: add source/auth events and runtime login state"
```

---

### Task 6: Promise 对话框

**Files:**
- Create: `src/ui/components/InputDialog.svelte`
- Create: `src/ui/components/SelectDialog.svelte`
- Create: `src/ui/dialogs.ts`
- Test: `tests/unit/ui/dialogs.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { showInputDialog, showSelectDialog } from '@/ui/dialogs';

describe('dialogs', () => {
    it('resolves input on confirm', async () => {
        const pending = showInputDialog('标题', '占位', '默认');
        const input = document.querySelector('input') as HTMLInputElement;
        expect(input.value).toBe('默认');
        input.value = '新值';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const confirm = document.querySelector('[data-action="confirm"]') as HTMLButtonElement;
        confirm.click();
        await expect(pending).resolves.toBe('新值');
        expect(document.querySelector('[data-dialog="input"]')).toBeNull();
    });

    it('resolves null on cancel', async () => {
        const pending = showInputDialog('标题', '', '');
        (document.querySelector('[data-action="cancel"]') as HTMLButtonElement).click();
        await expect(pending).resolves.toBeNull();
    });

    it('resolves selected index', async () => {
        const pending = showSelectDialog('选', ['A', 'B'], 1);
        const options = document.querySelectorAll('[data-action="option"]');
        expect(options).toHaveLength(2);
        (options[0] as HTMLButtonElement).click();
        await expect(pending).resolves.toBe(0);
    });
});
```

Svelte 5 bind 可能不会因原生 `input.value=` 更新。若失败，改成点击默认确认期望 `'默认'`，另测 cancel/select。实现时给 Input 一个 `data-dialog="input"` 根节点。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/ui/dialogs.test.ts`

Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现组件与入口**

`src/ui/dialogs.ts`：

```ts
import { mount, unmount } from 'svelte';
import InputDialog from './components/InputDialog.svelte';
import SelectDialog from './components/SelectDialog.svelte';

function mountDialog<T>(component: Parameters<typeof mount>[0], props: Record<string, unknown>): Promise<T | null> {
    return new Promise((resolve) => {
        const target = document.createElement('div');
        document.body.appendChild(target);
        const app = mount(component, {
            target,
            props: {
                ...props,
                onConfirm: (value: T) => {
                    cleanup();
                    resolve(value);
                },
                onCancel: () => {
                    cleanup();
                    resolve(null);
                },
            },
        });
        function cleanup() {
            try {
                unmount(app);
            } catch {
                /* already gone */
            }
            target.remove();
        }
    });
}

export function showInputDialog(title: string, placeholder: string, defaultValue = ''): Promise<string | null> {
    return mountDialog<string>(InputDialog, { title, placeholder, defaultValue });
}

export function showSelectDialog(title: string, options: string[], defaultIndex = 0): Promise<number | null> {
    return mountDialog<number>(SelectDialog, { title, options, defaultIndex });
}
```

`InputDialog.svelte`：props `title` `placeholder` `defaultValue` `onConfirm` `onCancel`；Escape 取消；input `onkeydown` `e.stopPropagation()`；确认按钮 `data-action="confirm"`，取消 `data-action="cancel"`；根 `data-dialog="input"`。样式对齐 Sidebar 深色面板（固定居中，z-index 10000）。

`SelectDialog.svelte`：每个选项 `data-action="option"` 的 button，点击 `onConfirm(index)`；高亮 `defaultIndex`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/ui/dialogs.test.ts`

Expected: PASS。若 bind 问题，把确认测试改成不改值，断言默认值。

- [ ] **Step 5: Commit**

```bash
git add src/ui/dialogs.ts src/ui/components/InputDialog.svelte src/ui/components/SelectDialog.svelte tests/unit/ui/dialogs.test.ts
git commit -m "feat: add promise input and select dialogs"
```

---

### Task 7: EpisodeMatcher 手动路径

**Files:**
- Modify: `src/services/episode-matcher.ts`
- Modify: `tests/unit/services/episode-matcher.test.ts`

- [ ] **Step 1: 扩展失败测试**

`EpisodeMatcherDeps` 将变为必填对话框。现有 `beforeEach` 必须传入 stub：

```ts
const dialogs = {
    showInputDialog: vi.fn(async () => null as string | null),
    showSelectDialog: vi.fn(async () => null as number | null),
};
matcher = new EpisodeMatcher({
    apiPrefix: 'https://api.example.com',
    chConvert: 0,
    ...dialogs,
});
```

追加用例（写在实现前，先红）：

```ts
it('skips cache in manual mode and uses dialogs', async () => {
    vi.mocked(Storage.getEpisodeCache).mockReturnValue({
        episodeId: 999,
        animeTitle: 'Cached',
        episodeTitle: 'Cached Ep',
        timestamp: Date.now(),
    });
    vi.mocked(searchEpisodes).mockResolvedValue(createSearchResponse(2));
    dialogs.showInputDialog.mockResolvedValue('Query Name');
    dialogs.showSelectDialog
        .mockResolvedValueOnce(1) // anime
        .mockResolvedValueOnce(2); // episode index

    const result = await matcher.match(createJellyfinItem(), 'manual');
    expect(Storage.getEpisodeCache).not.toHaveBeenCalled();
    expect(searchEpisodes).toHaveBeenCalledWith('https://api.example.com', 'Query Name');
    expect(result?.animeTitle).toBe('Anime 2');
    expect(result?.episodeId).toBe(3);
});

it('returns null when input dialog cancelled', async () => {
    vi.mocked(Storage.getEpisodeCache).mockReturnValue(null);
    dialogs.showInputDialog.mockResolvedValue(null);
    const result = await matcher.match(createJellyfinItem(), 'manual');
    expect(result).toBeNull();
    expect(searchEpisodes).not.toHaveBeenCalled();
});

it('appends season number when ParentIndexNumber > 1', async () => {
    vi.mocked(Storage.getEpisodeCache).mockReturnValue(null);
    vi.mocked(searchEpisodes).mockResolvedValue(createSearchResponse(1));
    await matcher.match(createJellyfinItem({ ParentIndexNumber: 2 }));
    expect(searchEpisodes).toHaveBeenCalledWith('https://api.example.com', 'Test Anime Series2');
});

it('uses 第N话 offset for auto episode index', async () => {
    vi.mocked(Storage.getEpisodeCache).mockReturnValue(null);
    vi.mocked(searchEpisodes).mockResolvedValue({
        hasMore: false,
        animes: [
            {
                animeId: 1,
                animeTitle: 'Anime 1',
                type: 'tvseries',
                episodes: [
                    { episodeId: 10, episodeTitle: '第3话 开始' },
                    { episodeId: 11, episodeTitle: '第4话 继续' },
                ],
            },
        ],
        errorCode: 0,
        errorMessage: '',
    });
    const result = await matcher.match(createJellyfinItem({ IndexNumber: 4 }));
    expect(result?.episodeId).toBe(11);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/services/episode-matcher.test.ts`

Expected: FAIL（manual 仍读缓存；无 第N话 偏移）

- [ ] **Step 3: 实现 matcher**

Deps：

```ts
export interface EpisodeMatcherDeps {
    apiPrefix: string;
    chConvert: ChConvertMode;
    showInputDialog: (title: string, placeholder: string, defaultValue?: string) => Promise<string | null>;
    showSelectDialog: (title: string, options: string[], defaultIndex?: number) => Promise<number | null>;
}
```

`match` 逻辑：

1. `mode === 'auto'` 且有 SeasonId + IndexNumber → 读缓存，命中则返回。
2. `animeName = SeriesName || Name`；若 `ParentIndexNumber > 1` 则 `animeName += String(ParentIndexNumber)`。
3. `mode === 'manual'`：`showInputDialog('确认动画名', '请输入动画名称', animeName)`，取消返回 null，确认值作为搜索名。
4. `searchEpisodes`；空则用 `item.OriginalTitle` 再搜。
5. 仍空 → null。
6. `mode === 'manual'`：`showSelectDialog('选择节目', animes.map(a => \`${a.animeTitle} 类型:${a.type}\`), 0)` 再 `showSelectDialog('选择剧集', episodes.map(e => e.episodeTitle), IndexNumber-1)`。取消返回 null。选中下标对应 episode。
7. auto：`firstTitle.match(/第(\d+)话/)`，否则 `第(\d+)集`；`initialEp` 默认 1；`numeric = IndexNumber || 1`；`episode = numeric < initialEp ? numeric : numeric - initialEp + 1`；下标 `episode - 1`。
8. 写 `setEpisodeCache`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/services/episode-matcher.test.ts`

Expected: PASS（含原有 auto 用例；`createSearchResponse` 仍用 `第N集`，次要正则要覆盖）

- [ ] **Step 5: Commit**

```bash
git add src/services/episode-matcher.ts tests/unit/services/episode-matcher.test.ts
git commit -m "feat: manual episode match dialogs and original title/season rules"
```

---

### Task 8: 关联源 shift 与并行拉取

**Files:**
- Modify: `src/services/comment-fetcher.ts:69-95`
- Modify: `tests/unit/services/comment-fetcher.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
it('applies related source shift to comment times', async () => {
    vi.mocked(getComments).mockResolvedValue([]);
    vi.mocked(getRelatedSources).mockResolvedValue([
        { url: 'https://other.com/a', shift: 5 },
    ]);
    vi.mocked(getExtComments).mockResolvedValue([
        { cid: 1, p: '1,1,16777215,u', m: 'shifted' },
    ]);
    const result = await fetcher.fetch(123, 'item-456');
    expect(result[0]?.time).toBe(6);
});

it('keeps main comments when one ext source fails', async () => {
    vi.mocked(getComments).mockResolvedValue([
        { cid: 1, p: '1,1,16777215,u', m: 'main' },
    ]);
    vi.mocked(getRelatedSources).mockResolvedValue([
        { url: 'https://other.com/bad', shift: 0 },
        { url: 'https://other.com/ok', shift: 0 },
    ]);
    vi.mocked(getExtComments)
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce([{ cid: 2, p: '2,1,16777215,u', m: 'ok' }]);
    const result = await fetcher.fetch(123, 'item-456');
    expect(result.map((c) => c.text).sort()).toEqual(['main', 'ok']);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/services/comment-fetcher.test.ts`

Expected: FAIL（time 仍为 1）

- [ ] **Step 3: 实现**

关联源循环改为 `Promise.all`。转换后：

```ts
const converted = extComments.map((c) => {
    const raw = convertDanDanPlayComment(c);
    return { ...raw, time: raw.time + (source.shift || 0) };
});
```

单个 catch 只 `logger.warn`，不中断其它源。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/services/comment-fetcher.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/comment-fetcher.ts tests/unit/services/comment-fetcher.test.ts
git commit -m "fix: apply related source shift and fetch ext comments in parallel"
```

---

### Task 9: DanmakuRuntime

**Files:**
- Create: `src/runtime.ts`
- Test: `tests/unit/runtime.test.ts`

Runtime 通过构造注入依赖，测试不碰真实引擎。

```ts
export type LoadReason = 'init' | 'search' | 'refresh' | 'settings-changed';

export type RuntimeMedia = {
    video: HTMLVideoElement | null;
    container: HTMLElement | null;
};

export type DanmakuRuntimeHooks = {
    matcher: EpisodeMatcher;
    fetcher: CommentFetcher;
    auth: DanDanPlayAuth;
    engine: { init: (config: EngineConfig, comments: RawComment[]) => void; destroy: () => void };
    getCurrentItem: typeof getCurrentItem;
    getMedia: () => RuntimeMedia;
    waitMs?: (ms: number) => Promise<void>;
};
```

生产路径：`new DanmakuRuntime()` 内部用默认 hooks（真实 matcher/fetcher/auth/`danmakuEngine`）。测试传入 fake。

行为：

- `start()`：订阅 `danmaku:reload` / `danmaku:add-source` / `auth:login` / `auth:logout` / `media:source-changed`（后者 delay 2000ms 再 `load('refresh')`）；`refreshIfNeeded`；`syncAuthState`；`load('init')`。
- `destroy()`：abort、退订、`engine.destroy()`。
- `load('search')` → `match(item, 'manual')`；其它 → `'auto'`。
- 新 JF：`itemId` 空则最多 10 次、每次 200ms（`waitMs`）再读 `danmakuState.itemId`。
- 匹配成功后若 `episodeId === lastEpisodeId` 且 reason 不是 `search` / `settings-changed` → return。
- 新 load 先 abort 上一次 controller，fetch 传 `signal`。
- `addSource`：无 `lastEpisodeId` 则 log 返回；`getExtComments` + convert 追加 `rawComments`，再 `engine.init`；`auth.isLoggedIn` 则 `postRelatedSource`。
- `login` / `logout` 后 `syncAuthState`：写 `danmakuState.ddplayLoggedIn/ddplayUserName`。
- load 失败只 log，不 throw；匹配失败不 `engine.destroy`。
- 成功后保存 `rawComments` 与 `lastEpisodeId`，`danmakuState.episodeInfo`。

- [ ] **Step 1: 写失败测试**

`tests/unit/runtime.test.ts` 用 vi.fn matcher/fetcher/engine/auth。至少覆盖：

1. `start` 调 `load` → matcher auto + fetcher + engine.init  
2. 相同 episodeId 的第二次 `refresh` 不 fetch  
3. `search` 走 manual 且可重复 load  
4. `addSource` 合并评论并在登录时 postRelated  
5. `destroy` 后 reload 不再 fetch  
6. fetch 进行中 `destroy` 会 abort（用 deferred promise + signal.aborted）

骨架：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DanmakuRuntime } from '@/runtime';
import { eventBus } from '@/core/event-bus';
import { danmakuState } from '@/core/state.svelte';

function createHooks() {
    const matcher = { match: vi.fn() };
    const fetcher = { fetch: vi.fn() };
    const auth = {
        isLoggedIn: false,
        token: '',
        login: vi.fn(),
        logout: vi.fn(),
        refreshIfNeeded: vi.fn(async () => {}),
    };
    const engine = { init: vi.fn(), destroy: vi.fn() };
    return { matcher, fetcher, auth, engine };
}
```

item 固定 `{ Id: 'i1', Name: 'N', SeasonId: 's', IndexNumber: 1 }`。`danmakuState.isNewJellyfin = false` 以免等 itemId。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/runtime.test.ts`

Expected: FAIL（`src/runtime.ts` 不存在）

- [ ] **Step 3: 实现 `src/runtime.ts`**

默认 hooks 构造：

```ts
const matcher = new EpisodeMatcher({
    apiPrefix: danmakuState.effectiveApiPrefix,
    chConvert: danmakuState.chConvert,
    showInputDialog,
    showSelectDialog,
});
```

`getMedia` 默认：`document.querySelector('video')` 与 `SELECTORS.mediaContainer`。

`waitMs` 默认 `(ms) => new Promise(r => setTimeout(r, ms))`。测试里 `waitMs: async () => {}`。

`CommentFetcher.fetch` 已有 `signal` 参数，Runtime 每次 load 新建 `AbortController`。

`addSource` 调 `getExtComments(danmakuState.effectiveApiPrefix, url, { chConvert: danmakuState.chConvert })`。

engine.init 的 config 与当前 `bootstrap.ts` `loadDanmaku` 相同（speed/opacity/heightRatio/visible 来自 `danmakuState`）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/runtime.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/runtime.ts tests/unit/runtime.test.ts
git commit -m "feat: extract DanmakuRuntime for load, search, add-source, auth"
```

---

### Task 10: bootstrap 接到 Runtime

**Files:**
- Modify: `src/bootstrap.ts`

- [ ] **Step 1: 无单独测试（生命周期依赖 DOM）。改完跑全量单测保证无回归。**

- [ ] **Step 2: 改 bootstrap**

删除对 `EpisodeMatcher` / `CommentFetcher` / `loadDanmaku` 的直接使用。

模块级 `let runtime: DanmakuRuntime | null = null`。

`initPlayer` 在 mount Toggle/Overlay 之后：

```ts
runtime = new DanmakuRuntime();
await runtime.start();
```

全局 `danmaku:reload` / `media:source-changed` 监听删掉（改由 Runtime.start 订阅）。若担心 start 前丢事件：先 `runtime.start()`（内部先订阅再 load）。

`cleanupPlayer`：

```ts
runtime?.destroy();
runtime = null;
```

仍 `unmount` Toggle/Debug/Sidebar。`openSidebar` 的 `onSave` / `onCancel` 必须先 `unmount(sidebarApp)` 再 `remove` DOM：

```ts
onSave: () => {
    danmakuState.persist();
    closeSidebar();
    eventBus.emit('danmaku:reload', { reason: 'settings-changed' });
},
onCancel: () => {
    danmakuState.hydrate();
    closeSidebar();
},
```

```ts
function closeSidebar() {
    if (sidebarApp) {
        try { unmount(sidebarApp); } catch { /* ignore */ }
        sidebarApp = null;
    }
    sidebarContainer?.remove();
    sidebarContainer = null;
    sidebarOpen = false;
}
```

删掉从未 `add` 的 `playerDisposables`，或在 `initPlayer` 里把 runtime.destroy 登记进去——选删除空壳。

- [ ] **Step 3: 跑全量测试**

Run: `npx vitest run`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/bootstrap.ts
git commit -m "refactor: bootstrap owns player lifecycle, Runtime owns danmaku flow"
```

---

### Task 11: Sidebar 加源与登录

**Files:**
- Modify: `src/ui/components/Sidebar.svelte` 控制页（约 71–112 行）

- [ ] **Step 1: 无组件单测。改完 `npx vitest run` + `npm run check`。**

- [ ] **Step 2: 控制页增加**

搜索按钮后：

```svelte
<div class="setting-item">
    <button class="action-btn" type="button" onclick={handleAddSource}>增加弹幕源</button>
</div>

<div class="setting-item">
    {#if danmakuState.ddplayLoggedIn}
        <span>已登录：{danmakuState.ddplayUserName}</span>
        <button class="action-btn" type="button" onclick={() => eventBus.emit('auth:logout', undefined)}>登出</button>
    {:else}
        <label>
            账号:
            <input class="setting-input" bind:value={account} onkeydown={stopHotkeys} />
        </label>
        <label>
            密码:
            <input class="setting-input" type="password" bind:value={password} onkeydown={stopHotkeys} />
        </label>
        <button class="action-btn" type="button" onclick={() => eventBus.emit('auth:login', { account, password })}>登录</button>
    {/if}
</div>
```

script：

```ts
import { showInputDialog } from '../dialogs';

let account = $state('');
let password = $state('');

function stopHotkeys(e: KeyboardEvent) {
    e.stopPropagation();
}

async function handleAddSource() {
    const url = await showInputDialog('增加弹幕源', '弹幕源 URL', '');
    if (!url) return;
    eventBus.emit('danmaku:add-source', { url });
}
```

所有 `.setting-input` 加 `onkeydown={stopHotkeys}`（控制页 CORS/API 同样）。

- [ ] **Step 3: 校验**

Run: `npx vitest run && npm run check && npm run typecheck`

Expected: 全过。`typecheck` 若不管 svelte，至少 `check` 过。

- [ ] **Step 4: Commit**

```bash
git add src/ui/components/Sidebar.svelte
git commit -m "feat: sidebar add-source and DanDanPlay login"
```

---

### Task 12: 全量验证

- [ ] **Step 1: 跑测试、lint、typecheck、check**

```bash
npx vitest run
npm run typecheck
npm run check
npm run lint
```

Expected: 全过。修复本轮引入的问题，不顺手改密度算法。

- [ ] **Step 2: 确认未暂存 another-version**

```bash
git status
```

Expected: 无 `another-version/` staged。

- [ ] **Step 3: 若有修复再提交**

```bash
git add <only files you fixed>
git commit -m "fix: typecheck and lint after runtime extraction"
```

---

## Spec coverage

| Spec | Task |
|------|------|
| 四段 `p`、保留 user 前缀 | 1 |
| XML 子路径、sender | 2 |
| Auth GET renew、errorCode、tokenExpireTime、ddplayStatus 迁移 | 3 |
| postComment / postRelatedSource 载荷 | 4 |
| eventBus 加源/登录、state 登录字段 | 5 |
| Promise 对话框 | 6 |
| 手动匹配、跳过缓存、季数、第N话、OriginalTitle | 7 |
| shift、并行 ext、失败降级 | 8 |
| Runtime load/search/addSource/login/abort/skip same episode | 9 |
| bootstrap 生命周期、sidebar unmount | 10 |
| Sidebar UI | 11 |
| 不做 Host/Studio/自研 canvas/发送 UI/密度对齐 | 全任务未包含 |

## 执行注意

- 每个 Task 独立可测、独立 commit。
- Windows PowerShell 下 `git commit -m "feat: ..."` 即可，不要 `&&` 进 another-version。
- `CommentFetcher.fetch` 必须继续接收 `signal`，供 Runtime abort。
