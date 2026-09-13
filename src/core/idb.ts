export const EPISODE_CACHE_STORE = 'episode-cache';

const DB_NAME = 'jellyfin-danmaku';
const DB_VERSION = 1;

let openPromise: Promise<IDBDatabase> | null = null;
let dbInstance: IDBDatabase | null = null;

export function resetDanmakuDb(): void {
    dbInstance?.close();
    dbInstance = null;
    openPromise = null;
}

export function openDanmakuDb(): Promise<IDBDatabase> {
    if (!openPromise) {
        openPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onerror = () => {
                openPromise = null;
                reject(request.error ?? new Error('indexedDB open failed'));
            };
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(EPISODE_CACHE_STORE)) {
                    const store = db.createObjectStore(EPISODE_CACHE_STORE, { keyPath: 'id' });
                    store.createIndex('timestamp', 'timestamp');
                }
            };
            request.onsuccess = () => {
                dbInstance = request.result;
                dbInstance.onclose = () => {
                    dbInstance = null;
                    openPromise = null;
                };
                resolve(dbInstance);
            };
        });
    }
    return openPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('indexedDB request failed'));
    });
}

export async function idbGet<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
    const db = await openDanmakuDb();
    const tx = db.transaction(storeName, 'readonly');
    return requestToPromise(tx.objectStore(storeName).get(key)) as Promise<T | undefined>;
}

export async function idbPut(storeName: string, value: unknown): Promise<void> {
    const db = await openDanmakuDb();
    const tx = db.transaction(storeName, 'readwrite');
    await requestToPromise(tx.objectStore(storeName).put(value));
}

export async function idbDelete(storeName: string, key: IDBValidKey): Promise<void> {
    const db = await openDanmakuDb();
    const tx = db.transaction(storeName, 'readwrite');
    await requestToPromise(tx.objectStore(storeName).delete(key));
}

export async function idbClear(storeName: string): Promise<void> {
    const db = await openDanmakuDb();
    const tx = db.transaction(storeName, 'readwrite');
    await requestToPromise(tx.objectStore(storeName).clear());
}

export async function idbGetAll<T>(storeName: string): Promise<T[]> {
    const db = await openDanmakuDb();
    const tx = db.transaction(storeName, 'readonly');
    return requestToPromise(tx.objectStore(storeName).getAll()) as Promise<T[]>;
}
