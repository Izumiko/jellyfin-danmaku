// Vitest 全局 setup
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach } from 'vitest';
import { resetDanmakuDb } from '../src/core/idb';

// Mock localStorage
const localStorageMock = (() => {
    let store: Record<string, string> = {};

    return {
        getItem: (key: string) => store[key] || null,
        setItem: (key: string, value: string) => {
            store[key] = value.toString();
        },
        removeItem: (key: string) => {
            delete store[key];
        },
        clear: () => {
            store = {};
        },
        key: (index: number) => Object.keys(store)[index] ?? null,
        get length() {
            return Object.keys(store).length;
        },
    };
})();

Object.defineProperty(global, 'localStorage', {
    value: localStorageMock,
});

// 每个测试前清空 localStorage
beforeEach(() => {
    localStorage.clear();
    resetDanmakuDb();
    Object.defineProperty(globalThis, 'indexedDB', {
        value: new IDBFactory(),
        configurable: true,
    });
});
