import { describe, it, expect } from 'vitest';
import { buildLocalDanmakuUrl, parseXmlDanmaku } from '@/services/jellyfin/danmaku';

describe('buildLocalDanmakuUrl', () => {
    it('rewrites /web/index.html subpath', () => {
        expect(
            buildLocalDanmakuUrl('https://jf.example', '/jellyfin/web/index.html', 'abc'),
        ).toBe('https://jf.example/jellyfin/api/danmu/abc/raw');
    });

    it('rewrites /web/ without index.html', () => {
        expect(
            buildLocalDanmakuUrl('https://jf.example', '/web/', 'abc'),
        ).toBe('https://jf.example/api/danmu/abc/raw');
    });
});

describe('parseXmlDanmaku', () => {
    it('parses 8-field XML p and keeps sender as user', () => {
        const xml = `<?xml version="1.0"?><i><d p="392.0,1,25,16777215,0,0,[BiliBili]e686,1723">hi</d></i>`;
        expect(parseXmlDanmaku(xml)[0]).toMatchObject({
            time: 392,
            modeId: 1,
            color: 16777215,
            text: 'hi',
            user: '[BiliBili]e686',
        });
    });
});
