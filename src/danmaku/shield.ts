import type { BlockRules, DanmakuConfig, RawComment } from '../types/index';

type BlockConfig = Pick<
    DanmakuConfig,
    'blockKeywords' | 'blockUsers' | 'blockColors' | 'blockEnableKeywords' | 'blockEnableUsers' | 'blockEnableColors'
>;

/** 拆分规则文本：每行一条，忽略空行与 # 注释 */
export function parseRuleLines(text: string): string[] {
    return String(text || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'));
}

/**
 * 解析屏蔽规则。
 * 关键词默认按「包含」匹配；写成 /正则/flags 或 re:正则 时按正则匹配，正则无效则退回普通文本。
 */
export function parseBlockRules(config: BlockConfig): BlockRules {
    const keywords: BlockRules['keywords'] = [];
    if (config.blockEnableKeywords) {
        for (const line of parseRuleLines(config.blockKeywords)) {
            const slashed = line.match(/^\/(.+)\/([gimsuy]*)$/);
            const source = slashed ? slashed[1] : line.startsWith('re:') ? line.slice(3) : null;
            if (source !== null) {
                try {
                    // 去掉 g：带 g 的正则 test() 会记住 lastIndex，连续匹配结果不稳定
                    keywords.push({ re: new RegExp(source, (slashed?.[2] ?? '').replace(/g/g, '')), text: line });
                    continue;
                } catch {
                    // 无效正则按普通文本处理
                }
            }
            keywords.push({ re: null, text: line });
        }
    }

    const users = config.blockEnableUsers ? parseRuleLines(config.blockUsers) : [];

    const colors: string[] = [];
    if (config.blockEnableColors) {
        for (const token of String(config.blockColors || '').split(/[\s,;，]+/)) {
            const hex = token.trim().replace(/^#/, '').toLowerCase();
            if (/^[0-9a-f]{6}$/.test(hex)) colors.push(hex);
        }
    }

    return { keywords, users, colors };
}

export function hasBlockRules(rules: BlockRules): boolean {
    return rules.keywords.length > 0 || rules.users.length > 0 || rules.colors.length > 0;
}

/** 按屏蔽规则过滤原始弹幕；关键词同时匹配正文与发送者 */
export function applyBlockRules(comments: RawComment[], rules: BlockRules): { comments: RawComment[]; blocked: number } {
    if (!hasBlockRules(rules)) return { comments, blocked: 0 };

    const kept: RawComment[] = [];
    for (const comment of comments) {
        const text = comment.text ?? '';
        const user = comment.user ?? '';
        const color = (comment.color >>> 0).toString(16).padStart(6, '0');

        const hit =
            rules.keywords.some((rule) => (rule.re ? rule.re.test(text) || rule.re.test(user) : text.includes(rule.text) || user.includes(rule.text))) ||
            rules.users.some((u) => user.includes(u)) ||
            rules.colors.includes(color);

        if (!hit) kept.push(comment);
    }
    return { comments: kept, blocked: comments.length - kept.length };
}

/** 去掉第三方 API 拼在正文尾部的 B 站点赞数，如「开饭开饭 🤍 28」「好耶 ❤️ 3」 */
export function stripLikeSuffix(text: string): string {
    const cleaned = text.replace(/\s*[🤍❤♥💛💙💚💜🖤🧡]️?\s*\d+\s*$/u, '').trim();
    return cleaned.length > 0 ? cleaned : text;
}
