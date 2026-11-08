import { describe, it, expect } from 'vitest';
import { exportBlockRules, parseBlockRulesBackup } from '@/core/block-backup';
import { DEFAULT_CONFIG } from '@/core/config';
import type { DanmakuConfig } from '@/types/index';

const config: DanmakuConfig = {
    ...DEFAULT_CONFIG,
    blockKeywords: '剧透\n/^前方高能/',
    blockUsers: '[BiliBili]bot',
    blockColors: 'ff0000',
    blockEnableKeywords: true,
    blockEnableUsers: false,
    blockEnableColors: true,
    mergeSimilar: true,
    mergeThreshold: 90,
    stripLikeSuffix: false,
};

describe('block rule backup', () => {
    it('round-trips block rules', () => {
        const parsed = parseBlockRulesBackup(exportBlockRules(config));

        expect(parsed).toEqual({
            blockKeywords: config.blockKeywords,
            blockUsers: config.blockUsers,
            blockColors: config.blockColors,
            blockEnableKeywords: true,
            blockEnableUsers: false,
            blockEnableColors: true,
            mergeSimilar: true,
            mergeThreshold: 90,
            stripLikeSuffix: false,
        });
    });

    it('accepts the 0/1 and string values used by ede.js forms', () => {
        const parsed = parseBlockRulesBackup(
            JSON.stringify({
                version: 2,
                blockKeywords: 'spam',
                blockEnableKeywords: 1,
                blockEnableUsers: 0,
                blockEnableColors: '1',
                mergeSimilar: '0',
                mergeThreshold: '120',
            }),
        );

        expect(parsed.blockEnableKeywords).toBe(true);
        expect(parsed.blockEnableUsers).toBe(false);
        expect(parsed.blockEnableColors).toBe(true);
        expect(parsed.mergeSimilar).toBe(false);
        expect(parsed.mergeThreshold).toBe(100);
    });

    it('rejects invalid JSON and payloads without block rules', () => {
        expect(() => parseBlockRulesBackup('not json')).toThrow('JSON');
        expect(() => parseBlockRulesBackup(JSON.stringify({ hello: 'world' }))).toThrow('屏蔽规则');
    });
});
