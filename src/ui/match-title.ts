import { SELECTORS } from '../core/config';
import type { EpisodeInfo } from '../types/index';

const TITLE_ID = 'danmakuInfoTitle';

export function showMatchTitle(info: Pick<EpisodeInfo, 'animeTitle' | 'episodeTitle'>): void {
    const header = document.querySelector(SELECTORS.skinHeader);
    if (!header) return;

    let el = document.getElementById(TITLE_ID);
    if (!el) {
        el = document.createElement('div');
        el.id = TITLE_ID;
        el.className = 'pageTitle';
        header.appendChild(el);
    }
    el.textContent = `弹幕匹配信息：${info.animeTitle} - ${info.episodeTitle}`;
}

export function hideMatchTitle(): void {
    document.getElementById(TITLE_ID)?.remove();
}
