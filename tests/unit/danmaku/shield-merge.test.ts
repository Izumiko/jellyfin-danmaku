import { describe, it, expect } from 'vitest';
import { applyBlockRules, parseBlockRules, stripLikeSuffix } from '@/danmaku/shield';
import { mergeSimilarComments } from '@/danmaku/merge';
import { similarityPercentage } from '@/danmaku/similarity';
import { classifySource, filterBySource, preProcessWithReport, sourceStats } from '@/danmaku/processor';
import { DensityLimit } from '@/types/index';
import type { ProcessedComment, RawComment } from '@/types/index';

const raw = (text: string, extra: Partial<RawComment> = {}): RawComment => ({ time: 1, modeId: 1, color: 0xffffff, text, user: 'u1', ...extra });
const processed = (text: string, time = 0, mode: ProcessedComment['mode'] = 'rtl'): ProcessedComment => ({
    text,
    time,
    mode,
    style: { font: '18px sans-serif', fillStyle: '#fff', strokeStyle: '#000', lineWidth: 2 },
});

const enabledRules = {
    blockKeywords: '',
    blockUsers: '',
    blockColors: '',
    blockEnableKeywords: true,
    blockEnableUsers: true,
    blockEnableColors: true,
};

describe('block rules', () => {
    it('matches plain keywords, /regex/ and re: rules against text and sender', () => {
        const rules = parseBlockRules({ ...enabledRules, blockKeywords: '# 注释\n剧透\n/^前方.*能$/i\nre:\\d{6,}\n[gamer]' });
        const { comments, blocked } = applyBlockRules(
            [raw('不要剧透啊'), raw('前方高能'), raw('电话 1234567'), raw('正常弹幕'), raw('来自巴哈', { user: '[Gamer]x' })],
            rules,
        );
        expect(comments.map((c) => c.text)).toEqual(['正常弹幕', '来自巴哈']);
        expect(blocked).toBe(3);
    });

    it('treats an invalid regex as plain text instead of throwing', () => {
        const rules = parseBlockRules({ ...enabledRules, blockKeywords: '/[unclosed/' });
        expect(rules.keywords[0]).toEqual({ re: null, text: '/[unclosed/' });
    });

    it('blocks senders and colors, and respects the enable switches', () => {
        const comments = [raw('a', { user: '[BiliBili]spam' }), raw('b', { color: 0xff0000 }), raw('c')];
        const rules = parseBlockRules({ ...enabledRules, blockUsers: 'spam', blockColors: '#FF0000, 00ff00' });
        expect(applyBlockRules(comments, rules).comments.map((c) => c.text)).toEqual(['c']);

        const disabled = parseBlockRules({ ...enabledRules, blockUsers: 'spam', blockColors: 'ff0000', blockEnableUsers: false, blockEnableColors: false });
        expect(applyBlockRules(comments, disabled).blocked).toBe(0);
    });

    it('strips Bilibili like-count suffixes, including variation selectors', () => {
        expect(stripLikeSuffix('开饭开饭 🤍 28')).toBe('开饭开饭');
        expect(stripLikeSuffix('好耶❤️3')).toBe('好耶');
        expect(stripLikeSuffix('🤍 28')).toBe('🤍 28');
        expect(stripLikeSuffix('第 28 话')).toBe('第 28 话');
    });
});

describe('similar merge', () => {
    it('computes edit-distance similarity', () => {
        expect(similarityPercentage('哈哈哈哈', '哈哈哈哈')).toBe(100);
        expect(similarityPercentage('哈哈哈哈', '哈哈哈')).toBe(75);
        expect(similarityPercentage('', 'a')).toBe(0);
    });

    it('merges similar comments within the time window and same mode only', () => {
        const result = mergeSimilarComments(
            [processed('哈哈哈哈哈', 0), processed('哈哈哈哈哈哈', 0.5), processed('哈哈哈哈哈', 1, 'top'), processed('哈哈哈哈哈', 5), processed('完全不同', 1)],
            80,
        );
        expect(result.map((c) => [c.text, c.time])).toEqual([
            ['哈哈哈哈哈 [x2]', 0],
            ['哈哈哈哈哈', 1],
            ['完全不同', 1],
            ['哈哈哈哈哈', 5],
        ]);
    });

    it('stays fast on large inputs thanks to length pruning', () => {
        const many = Array.from({ length: 20000 }, (_, i) => processed(i % 2 ? `弹幕内容${i}` : `短${i % 7}`, i * 0.01));
        const start = performance.now();
        mergeSimilarComments(many, 85);
        expect(performance.now() - start).toBeLessThan(3000);
    });
});

describe('source classification', () => {
    it('is case-insensitive so third-party APIs (misaka) are filtered correctly', () => {
        expect(classifySource('[bilibili]abc')).toBe('bilibili');
        expect(classifySource('[BiliBili]abc')).toBe('bilibili');
        expect(classifySource('[gamer]x')).toBe('gamer');
        expect(classifySource('[AcFun]x')).toBe('other');
        expect(classifySource('12345')).toBe('dandanplay');

        const kept = filterBySource([raw('a', { user: '[bilibili]1' }), raw('b', { user: '[gamer]2' })], {
            bilibili: false,
            gamer: true,
            dandanplay: true,
            other: true,
        });
        expect(kept.map((c) => c.text)).toEqual(['b']);
    });

    it('counts sources', () => {
        expect(sourceStats([raw('a', { user: '[bilibili]1' }), raw('b', { user: 'x' }), raw('c', { user: '[5dm]y' })])).toEqual({
            total: 3,
            bilibili: 1,
            gamer: 0,
            dandanplay: 1,
            other: 1,
        });
    });
});

describe('preProcessWithReport', () => {
    it('cleans, blocks, then merges and reports the blocked count', () => {
        const config = {
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
            stripLikeSuffix: true,
            mergeSimilar: true,
            mergeThreshold: 85,
            blockRules: parseBlockRules({ ...enabledRules, blockKeywords: '剧透' }),
        };
        const { comments, blocked } = preProcessWithReport(
            [raw('好耶 🤍 12', { time: 1 }), raw('好耶', { time: 1.5 }), raw('别剧透', { time: 2 })],
            config,
        );
        expect(blocked).toBe(1);
        expect(comments.map((c) => c.text)).toEqual(['好耶 [x2]']);
    });
});
