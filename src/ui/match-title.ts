import type { EpisodeInfo } from '../types/index';

const TITLE_ID = 'danmakuInfoTitle';

export function showMatchTitle(info: Pick<EpisodeInfo, 'animeTitle' | 'episodeTitle'>): void {
    let el = document.getElementById(TITLE_ID);
    if (!el) {
        el = document.createElement('div');
        el.id = TITLE_ID;
        el.className = 'hide-mouse-idle';
        Object.assign(el.style, {
            position: 'fixed',
            top: '2.5em',
            left: '4.5em',
            zIndex: '10002',
            color: '#fff',
            fontSize: '13px',
            lineHeight: '1.4',
            textShadow: '0 1px 2px #000',
            pointerEvents: 'none',
            maxWidth: 'min(70vw, 720px)',
        });
        document.body.appendChild(el);
    }
    el.textContent = `弹幕匹配：${info.animeTitle} - ${info.episodeTitle}`;
}

export function hideMatchTitle(): void {
    document.getElementById(TITLE_ID)?.remove();
}
