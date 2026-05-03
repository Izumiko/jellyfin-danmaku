import { describe, it, expect } from 'vitest';
import {
    preProcessDanmaku,
    deduplicateComments,
    filterBySource,
    filterByMode,
    limitDensity,
    formatComment,
} from '@/danmaku/processor';
import { DensityLimit } from '@/types/index';
import type { RawComment, ProcessingConfig } from '@/types/index';

const createComment = (overrides: Partial<RawComment> = {}): RawComment => ({
    time: 1.0,
    modeId: 1,
    color: 16777215,
    text: 'test',
    user: '[BiliBili]user1',
    ...overrides,
});

const defaultConfig: ProcessingConfig = {
    sourceFilter: { bilibili: true, gamer: true, dandanplay: true, other: true },
    modeFilter: { scroll: true, top: true, bottom: true },
    densityLimit: DensityLimit.Unlimited,
    fontSize: 18,
    fontFamily: 'sans-serif',
    fontOptions: '',
    speed: 200,
    timeOffset: 0,
    containerWidth: 1920,
    containerHeight: 1080,
};

describe('processor', () => {
    describe('deduplicateComments', () => {
        it('should remove duplicate comments', () => {
            const comments = [
                createComment({ time: 1.0, modeId: 1, color: 16777215, text: 'hello' }),
                createComment({ time: 1.0, modeId: 1, color: 16777215, text: 'hello' }),
                createComment({ time: 2.0, modeId: 1, color: 16777215, text: 'world' }),
            ];

            const result = deduplicateComments(comments);
            expect(result).toHaveLength(2);
        });

        it('should keep comments with same text but different time', () => {
            const comments = [
                createComment({ time: 1.0, text: 'hello' }),
                createComment({ time: 2.0, text: 'hello' }),
            ];

            const result = deduplicateComments(comments);
            expect(result).toHaveLength(2);
        });
    });

    describe('filterBySource', () => {
        it('should filter Bilibili comments when disabled', () => {
            const comments = [
                createComment({ user: '[BiliBili]user1' }),
                createComment({ user: '[Gamer]user2' }),
                createComment({ user: '[DanDanPlay]user3' }),
            ];

            const result = filterBySource(comments, { bilibili: false, gamer: true, dandanplay: true, other: true });
            expect(result).toHaveLength(2);
            expect(result[0].user).toBe('[Gamer]user2');
        });

        it('should filter by Gamer source', () => {
            const comments = [
                createComment({ user: '[BiliBili]user1' }),
                createComment({ user: '[Gamer]user2' }),
            ];

            const result = filterBySource(comments, { bilibili: true, gamer: false, dandanplay: true, other: true });
            expect(result).toHaveLength(1);
            expect(result[0].user).toBe('[BiliBili]user1');
        });

        it('should classify unknown users as other', () => {
            const comments = [
                createComment({ user: 'unknown' }),
            ];

            const result = filterBySource(comments, { bilibili: true, gamer: true, dandanplay: true, other: false });
            expect(result).toHaveLength(0);
        });
    });

    describe('filterByMode', () => {
        it('should filter scroll mode (1, 6)', () => {
            const comments = [
                createComment({ modeId: 1 }), // scroll
                createComment({ modeId: 4 }), // bottom
                createComment({ modeId: 5 }), // top
                createComment({ modeId: 6 }), // scroll
            ];

            const result = filterByMode(comments, { scroll: false, top: true, bottom: true });
            expect(result).toHaveLength(2);
            expect(result[0].modeId).toBe(4);
            expect(result[1].modeId).toBe(5);
        });

        it('should filter top mode (5)', () => {
            const comments = [
                createComment({ modeId: 1 }),
                createComment({ modeId: 5 }),
            ];

            const result = filterByMode(comments, { scroll: true, top: false, bottom: true });
            expect(result).toHaveLength(1);
            expect(result[0].modeId).toBe(1);
        });
    });

    describe('limitDensity', () => {
        it('should not limit when set to unlimited', () => {
            const comments = Array.from({ length: 20 }, (_, i) =>
                createComment({ time: i * 0.1, modeId: 1 }),
            );

            const result = limitDensity(comments, DensityLimit.Unlimited, 1);
            expect(result).toHaveLength(20);
        });

        it('should limit density for low setting', () => {
            const comments = Array.from({ length: 20 }, (_, i) =>
                createComment({ time: i * 0.1, modeId: 1 }),
            );

            const result = limitDensity(comments, DensityLimit.Low, 1);
            expect(result.length).toBeLessThan(20);
        });

        it('should limit scroll and fixed comments separately', () => {
            const comments = [
                ...Array.from({ length: 10 }, (_, i) => createComment({ time: i * 0.1, modeId: 1 })),
                ...Array.from({ length: 10 }, (_, i) => createComment({ time: i * 0.1, modeId: 5 })),
            ];

            const result = limitDensity(comments, DensityLimit.Low, 1);
            // Low limit = 3 per bucket per type
            expect(result.length).toBeLessThan(20);
        });
    });

    describe('formatComment', () => {
        it('should convert modeId to mode string', () => {
            const comment = createComment({ modeId: 1, text: 'test', color: 16777215 });
            const result = formatComment(comment, { fontSize: 18, fontFamily: 'sans-serif', fontOptions: '', timeOffset: 0 });

            expect(result.mode).toBe('rtl');
            expect(result.text).toBe('test');
        });

        it('should apply time offset', () => {
            const comment = createComment({ time: 10.0 });
            const result = formatComment(comment, { fontSize: 18, fontFamily: 'sans-serif', fontOptions: '', timeOffset: 5.0 });

            expect(result.time).toBe(15.0);
        });

        it('should convert color to hex', () => {
            const comment = createComment({ color: 0xff0000 });
            const result = formatComment(comment, { fontSize: 18, fontFamily: 'sans-serif', fontOptions: '', timeOffset: 0 });

            expect(result.style.fillStyle).toBe('#ff0000');
        });
    });

    describe('preProcessDanmaku', () => {
        it('should process comments end-to-end', () => {
            const comments = [
                createComment({ time: 1.0, modeId: 1, text: 'hello', user: '[Gamer]user' }),
                createComment({ time: 1.0, modeId: 1, text: 'hello', user: '[Gamer]user' }), // duplicate
                createComment({ time: 2.0, modeId: 4, text: 'world', user: '[BiliBili]x' }),
            ];

            const config: ProcessingConfig = {
                ...defaultConfig,
                sourceFilter: { bilibili: false, gamer: true, dandanplay: true, other: true },
            };

            const result = preProcessDanmaku(comments, config);
            expect(result).toHaveLength(1);
            expect(result[0].text).toBe('hello');
        });
    });
});
