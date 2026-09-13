import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
    EPISODE_CACHE_STORE,
    idbClear,
    idbDelete,
    idbGet,
    idbPut,
    resetDanmakuDb,
} from '@/core/idb';

describe('idb episode-cache store', () => {
    beforeEach(() => {
        resetDanmakuDb();
        Object.defineProperty(globalThis, 'indexedDB', {
            value: new IDBFactory(),
            configurable: true,
        });
    });

    it('puts and gets a record by id', async () => {
        await idbPut(EPISODE_CACHE_STORE, { id: 'season:1', episodeId: 42, timestamp: 1 });
        await expect(idbGet(EPISODE_CACHE_STORE, 'season:1')).resolves.toEqual({
            id: 'season:1',
            episodeId: 42,
            timestamp: 1,
        });
    });

    it('deletes a record', async () => {
        await idbPut(EPISODE_CACHE_STORE, { id: 'season:1', episodeId: 42, timestamp: 1 });
        await idbDelete(EPISODE_CACHE_STORE, 'season:1');
        await expect(idbGet(EPISODE_CACHE_STORE, 'season:1')).resolves.toBeUndefined();
    });

    it('clears the store', async () => {
        await idbPut(EPISODE_CACHE_STORE, { id: 'a:1', episodeId: 1, timestamp: 1 });
        await idbClear(EPISODE_CACHE_STORE);
        await expect(idbGet(EPISODE_CACHE_STORE, 'a:1')).resolves.toBeUndefined();
    });
});
