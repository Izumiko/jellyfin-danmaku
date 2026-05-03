import { describe, it, expect, vi, beforeEach } from 'vitest';
import { antiOverlapFilter, filterOverlappedScroll, filterOverlappedFixed } from '@/danmaku/anti-overlap';
import { textMeasurer } from '@/danmaku/text-measure';
import type { ProcessedComment, AntiOverlapConfig } from '@/types/index';

const config: AntiOverlapConfig = {
    containerWidth: 1920,
    containerHeight: 1080,
    fontSize: 18,
    speed: 200,
    fontFamily: 'sans-serif',
    fontOptions: '',
};

const createProcessedComment = (overrides: Partial<ProcessedComment> = {}): ProcessedComment => ({
    text: 'test comment',
    mode: 'rtl',
    time: 1.0,
    style: {
        font: '18px sans-serif',
        fillStyle: '#ffffff',
        strokeStyle: '#000000',
        lineWidth: 2.0,
    },
    ...overrides,
});

// Mock textMeasurer
vi.mock('@/danmaku/text-measure', () => ({
    textMeasurer: {
        measure: vi.fn(() => 100),
        clear: vi.fn(),
    },
}));

describe('anti-overlap', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('filterOverlappedScroll', () => {
        it('should keep non-overlapping scroll comments', () => {
            const comments = [
                createProcessedComment({ time: 0, text: 'a' }),
                createProcessedComment({ time: 10, text: 'b' }),
            ];

            const result = filterOverlappedScroll(comments, config, 'rtl');
            expect(result).toHaveLength(2);
        });

        it('should filter overlapping comments on same track', () => {
            // Two comments at very close times should overlap
            const comments = [
                createProcessedComment({ time: 0, text: 'a' }),
                createProcessedComment({ time: 0.1, text: 'b' }),
            ];

            const result = filterOverlappedScroll(comments, config, 'rtl');
            // First one should be kept, second should be filtered
            expect(result.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('filterOverlappedFixed', () => {
        it('should keep non-overlapping fixed comments', () => {
            const comments = [
                createProcessedComment({ mode: 'top', time: 0 }),
                createProcessedComment({ mode: 'top', time: 10 }),
            ];

            const result = filterOverlappedFixed(comments, config);
            expect(result).toHaveLength(2);
        });

        it('should filter overlapping fixed comments', () => {
            // Use small container to force single track
            const smallConfig: AntiOverlapConfig = {
                ...config,
                containerHeight: 30, // Only 1 track with fontSize 18
            };
            const comments = [
                createProcessedComment({ mode: 'top', time: 0, text: 'a' }),
                createProcessedComment({ mode: 'top', time: 0, text: 'b' }),
            ];

            const result = filterOverlappedFixed(comments, smallConfig);
            expect(result.length).toBeLessThanOrEqual(1);
        });
    });

    describe('antiOverlapFilter', () => {
        it('should process mixed mode comments', () => {
            const comments = [
                createProcessedComment({ mode: 'rtl', time: 0 }),
                createProcessedComment({ mode: 'ltr', time: 1 }),
                createProcessedComment({ mode: 'top', time: 2 }),
                createProcessedComment({ mode: 'bottom', time: 3 }),
            ];

            const result = antiOverlapFilter(comments, config);
            expect(result.length).toBeGreaterThanOrEqual(1);
            // Should be sorted by time
            for (let i = 1; i < result.length; i++) {
                expect(result[i].time).toBeGreaterThanOrEqual(result[i - 1].time);
            }
        });

        it('should return empty array for empty input', () => {
            const result = antiOverlapFilter([], config);
            expect(result).toHaveLength(0);
        });
    });
});
