import type { DanmakuConfig } from '../types/index';

/** 原版 ede.js「屏蔽规则导出」的 JSON 结构 */
export interface BlockRulesBackup {
    version: 2;
    blockKeywords: string;
    blockUsers: string;
    blockColors: string;
    blockEnableKeywords: number;
    blockEnableUsers: number;
    blockEnableColors: number;
    mergeSimilar: number;
    mergeThreshold: number;
    stripLikeSuffix: number;
}

type BlockConfig = Pick<
    DanmakuConfig,
    'blockKeywords' | 'blockUsers' | 'blockColors' | 'blockEnableKeywords' | 'blockEnableUsers' | 'blockEnableColors' | 'mergeSimilar' | 'mergeThreshold' | 'stripLikeSuffix'
>;

function booleanInt(value: boolean): number {
    return value ? 1 : 0;
}

function readBoolean(value: unknown): boolean | undefined {
    if (value === true || value === 1 || value === '1') return true;
    if (value === false || value === 0 || value === '0') return false;
    return undefined;
}

function readString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

/**
 * 导出屏蔽规则。字段名与 ede.js 的「屏蔽规则导出」保持一致，
 * 两个方向的备份可以互相导入。
 */
export function exportBlockRules(config: BlockConfig): string {
    const payload: BlockRulesBackup = {
        version: 2,
        blockKeywords: config.blockKeywords,
        blockUsers: config.blockUsers,
        blockColors: config.blockColors,
        blockEnableKeywords: booleanInt(config.blockEnableKeywords),
        blockEnableUsers: booleanInt(config.blockEnableUsers),
        blockEnableColors: booleanInt(config.blockEnableColors),
        mergeSimilar: booleanInt(config.mergeSimilar),
        mergeThreshold: config.mergeThreshold,
        stripLikeSuffix: booleanInt(config.stripLikeSuffix),
    };
    return JSON.stringify(payload, null, 2);
}

/**
 * 解析屏蔽规则备份（兼容 ede.js 表单使用的 0/1 与字符串值）。
 * @throws JSON 无效或没有任何可识别的屏蔽规则时
 */
export function parseBlockRulesBackup(text: string): Partial<DanmakuConfig> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error('不是有效的 JSON');
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('不是有效的屏蔽规则备份');
    }

    const source = parsed as Record<string, unknown>;
    const result: Partial<DanmakuConfig> = {};

    const keywords = readString(source.blockKeywords);
    if (keywords !== undefined) result.blockKeywords = keywords;
    const users = readString(source.blockUsers);
    if (users !== undefined) result.blockUsers = users;
    const colors = readString(source.blockColors);
    if (colors !== undefined) result.blockColors = colors;

    const enableKeywords = readBoolean(source.blockEnableKeywords);
    if (enableKeywords !== undefined) result.blockEnableKeywords = enableKeywords;
    const enableUsers = readBoolean(source.blockEnableUsers);
    if (enableUsers !== undefined) result.blockEnableUsers = enableUsers;
    const enableColors = readBoolean(source.blockEnableColors);
    if (enableColors !== undefined) result.blockEnableColors = enableColors;

    const mergeSimilar = readBoolean(source.mergeSimilar);
    if (mergeSimilar !== undefined) result.mergeSimilar = mergeSimilar;
    const stripLikeSuffix = readBoolean(source.stripLikeSuffix);
    if (stripLikeSuffix !== undefined) result.stripLikeSuffix = stripLikeSuffix;

    const threshold = source.mergeThreshold;
    if (typeof threshold === 'number' && Number.isFinite(threshold)) {
        result.mergeThreshold = Math.min(100, Math.max(50, Math.round(threshold)));
    } else if (typeof threshold === 'string' && threshold.trim() !== '') {
        const parsedThreshold = Number.parseInt(threshold, 10);
        if (Number.isFinite(parsedThreshold)) {
            result.mergeThreshold = Math.min(100, Math.max(50, parsedThreshold));
        }
    }

    if (Object.keys(result).length === 0) {
        throw new Error('没有识别到屏蔽规则');
    }

    return result;
}
