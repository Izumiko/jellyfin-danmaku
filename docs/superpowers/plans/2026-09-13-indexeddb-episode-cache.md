# IndexedDB Episode Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (this session: user asked to start immediately after the plan).

**Goal:** Move episode match cache from localStorage to IndexedDB; keep config and login in localStorage.

**Architecture:** Native IDB wrapper in `src/core/idb.ts`. `Storage` episode APIs become async. Matcher awaits them. `Runtime.start` migrates old keys then sweeps TTL.

**Tech Stack:** TypeScript, native IndexedDB, `fake-indexeddb` (dev), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-13-indexeddb-episode-cache-design.md`

---

### Task 1: fake-indexeddb setup + idb wrapper

**Files:**
- Create: `src/core/idb.ts`
- Create: `tests/unit/core/idb.test.ts`
- Modify: `tests/setup.ts`, `package.json`

- [ ] Install `fake-indexeddb`, import `fake-indexeddb/auto` in setup, reset factory + `resetDanmakuDb()` each test.
- [ ] TDD `openDanmakuDb`, `idbGet`, `idbPut`, `idbDelete`, `idbClear` against store `episode-cache`.
- [ ] Commit: `feat: native IndexedDB helper for episode cache`

### Task 2: Storage episode API on IDB

**Files:**
- Modify: `src/core/storage.ts`
- Modify: `tests/unit/core/storage.test.ts`

- [ ] `getEpisodeCache` / `setEpisodeCache` async; key `${seasonId}:${episodeIndex}`; TTL 30d on get.
- [ ] `migrateEpisodeCacheFromLocalStorage`, `sweepExpiredEpisodeCache`, async `clear`.
- [ ] IDB failure → get null, set no-op.
- [ ] Commit: `feat: store episode match cache in IndexedDB`

### Task 3: Matcher + Runtime wiring

**Files:**
- Modify: `src/services/episode-matcher.ts`
- Modify: `src/runtime.ts`
- Modify: `tests/unit/services/episode-matcher.test.ts`

- [ ] Await Storage episode methods.
- [ ] Matcher mocks use `mockResolvedValue`.
- [ ] `Runtime.start` migrate then sweep before `load('init')`.
- [ ] Commit: `feat: async episode cache in matcher and runtime start`

### Task 4: Verify

- [ ] `npx vitest run tests/unit`, `npm run typecheck`, `npm run check`
- [ ] Do not git add `another-version/`
