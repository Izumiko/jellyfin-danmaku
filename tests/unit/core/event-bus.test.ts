import { describe, it, expect } from 'vitest';
import { eventBus } from '@/core/event-bus';

describe('EventBus', () => {
    it('should emit and receive events', () => {
        let received: { reason: string } | null = null;

        const unsubscribe = eventBus.on('danmaku:reload', (data) => {
            received = data;
        });

        eventBus.emit('danmaku:reload', { reason: 'init' });

        expect(received).toEqual({ reason: 'init' });

        unsubscribe();
    });

    it('should unsubscribe correctly', () => {
        let callCount = 0;

        const unsubscribe = eventBus.on('danmaku:reload', () => {
            callCount++;
        });

        eventBus.emit('danmaku:reload', { reason: 'init' });
        expect(callCount).toBe(1);

        unsubscribe();

        eventBus.emit('danmaku:reload', { reason: 'refresh' });
        expect(callCount).toBe(1); // Should not increase
    });

    it('should handle multiple subscribers', () => {
        const calls: string[] = [];

        const unsub1 = eventBus.on('danmaku:reload', () => calls.push('handler1'));
        const unsub2 = eventBus.on('danmaku:reload', () => calls.push('handler2'));

        eventBus.emit('danmaku:reload', { reason: 'init' });

        expect(calls).toEqual(['handler1', 'handler2']);

        unsub1();
        unsub2();
    });

    it('emits danmaku:add-source and auth events', () => {
        const sources: string[] = [];
        const unsub = eventBus.on('danmaku:add-source', (data) => sources.push(data.url));
        eventBus.emit('danmaku:add-source', { url: 'https://example.com' });
        expect(sources).toEqual(['https://example.com']);
        unsub();
    });

    it('should clear all events', () => {
        let callCount = 0;

        eventBus.on('danmaku:reload', () => callCount++);
        eventBus.clear();

        eventBus.emit('danmaku:reload', { reason: 'init' });

        expect(callCount).toBe(0);
    });
});
