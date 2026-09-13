import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { hideMatchTitle, showMatchTitle } from '@/ui/match-title';

describe('match title', () => {
    beforeEach(() => {
        const header = document.createElement('div');
        header.className = 'skinHeader';
        document.body.appendChild(header);
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('appends match info to skinHeader', () => {
        showMatchTitle({ animeTitle: '某科学的超电磁炮', episodeTitle: '第1话' });
        const el = document.getElementById('danmakuInfoTitle');
        expect(el).not.toBeNull();
        expect(el?.className).toBe('pageTitle');
        expect(el?.textContent).toBe('弹幕匹配信息：某科学的超电磁炮 - 第1话');
        expect(document.querySelector('div.skinHeader')?.contains(el)).toBe(true);
    });

    it('updates existing title instead of duplicating', () => {
        showMatchTitle({ animeTitle: 'A', episodeTitle: 'E1' });
        showMatchTitle({ animeTitle: 'B', episodeTitle: 'E2' });
        expect(document.querySelectorAll('#danmakuInfoTitle')).toHaveLength(1);
        expect(document.getElementById('danmakuInfoTitle')?.textContent).toBe('弹幕匹配信息：B - E2');
    });

    it('removes the title on hide', () => {
        showMatchTitle({ animeTitle: 'A', episodeTitle: 'E1' });
        hideMatchTitle();
        expect(document.getElementById('danmakuInfoTitle')).toBeNull();
    });
});
