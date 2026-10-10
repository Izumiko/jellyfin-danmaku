import { get } from './http';
import { searchEpisodes } from './dandanplay/client';

/** 御坂网络（misaka_danmu_server）的弹弹Play 兼容接口：<服务地址>/api/v1/<客户端 token> */
export function buildMisakaPrefix(base: string, token: string): string {
    const b = base.trim().replace(/\/+$/, '');
    const t = token.trim().replace(/^\/+|\/+$/g, '');
    if (!b) return '';
    if (/\/api\/v1\/[^/]+$/.test(b)) return b;
    return t ? `${b}/api/v1/${t}` : '';
}

/** 把已配置的 API 地址拆回「服务地址 + token」，用于回填表单 */
export function splitMisakaPrefix(prefix: string): { base: string; token: string } | null {
    const match = prefix.trim().match(/^(.*?)\/api\/v1\/([^/]+)$/);
    return match ? { base: match[1], token: match[2] } : null;
}

/**
 * 测试弹幕 API：御坂网络先探活 /api/health（免鉴权），再用当前番剧名试搜一次。
 * @returns 每一步的结果说明
 */
export async function testApiConnection(apiPrefix: string, title: string): Promise<string[]> {
    const lines: string[] = [];

    const misaka = splitMisakaPrefix(apiPrefix);
    if (misaka) {
        try {
            const health = await get<unknown>(`${misaka.base}/api/health`, { timeout: 5000, retries: 0 });
            const text = typeof health === 'string' ? health : JSON.stringify(health);
            lines.push(`服务探活：${text.slice(0, 80)}`);
        } catch (error) {
            lines.push(`服务探活失败：${error instanceof Error ? error.message : String(error)}`);
        }
    }

    if (!title) {
        lines.push('还没有识别到当前番剧名，播放一集后再试搜');
        return lines;
    }
    try {
        const result = await searchEpisodes(apiPrefix, title);
        const animes = result.animes ?? [];
        lines.push(`搜索「${title}」：${animes.length} 个结果`);
        if (animes[0]) lines.push(`首个结果：${animes[0].animeTitle}（${animes[0].episodes?.length ?? 0} 集）`);
    } catch (error) {
        lines.push(`搜索失败：${error instanceof Error ? error.message : String(error)}`);
    }
    return lines;
}
