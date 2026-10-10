import { describe, it, expect } from 'vitest';
import { extractEpisodeNumber, pickBestAnime, seasonHint, titleMatchScore } from '@/services/title-match';
import { selectEpisodeIndex } from '@/services/episode-matcher';
import type { AnimeInfo } from '@/types/index';

const anime = (title: string, episodeTitles: string[] = []): AnimeInfo => ({
    animeId: title.length,
    animeTitle: title,
    type: 'tvseries',
    episodes: episodeTitles.map((episodeTitle, i) => ({ episodeId: i + 1, episodeTitle })),
});

describe('extractEpisodeNumber', () => {
    it('understands common episode title formats', () => {
        expect(extractEpisodeNumber('第4话 标题')).toBe(4);
        expect(extractEpisodeNumber('第 12 集')).toBe(12);
        expect(extractEpisodeNumber('第3話')).toBe(3);
        expect(extractEpisodeNumber('S02E04')).toBe(4);
        expect(extractEpisodeNumber('7')).toBe(7);
        expect(extractEpisodeNumber('8. 新的旅程')).toBe(8);
        expect(extractEpisodeNumber('OVA 特别篇')).toBeNull();
        expect(extractEpisodeNumber('2024 年回顾')).toBe(2024);
    });
});

describe('selectEpisodeIndex', () => {
    it('matches by the number in the title so missing episodes do not shift later ones', () => {
        // 源站缺第 1 集：顺序推算会把第 3 集错配到「第4话」
        const season = anime('X', ['第2话', '第3话', '第4话']);
        expect(selectEpisodeIndex(season, 3)).toBe(1);
    });

    it('handles bare-number titles from third-party APIs', () => {
        expect(selectEpisodeIndex(anime('X', ['1', '2', '3']), 2)).toBe(1);
    });

    it('falls back to counting from the first episode number', () => {
        // 第二季从「第13话」开始，Jellyfin 按 1 开始编号
        expect(selectEpisodeIndex(anime('X', ['第13话', '第14话', '第15话']), 2)).toBe(1);
    });
});

describe('pickBestAnime', () => {
    it('prefers the candidate whose season matches the query', () => {
        const animes = [anime('幼女战记'), anime('幼女战记 第二季'), anime('幼女战记 剧场版')];
        expect(seasonHint('幼女战记2', true)).toBe(2);
        expect(pickBestAnime(animes, '幼女战记2').index).toBe(1);
    });

    it('prefers an exact title over a longer one', () => {
        const animes = [anime('葬送的芙莉莲 ～魔法使的冒险～ 特别篇'), anime('葬送的芙莉莲')];
        expect(pickBestAnime(animes, '葬送的芙莉莲').index).toBe(1);
        expect(titleMatchScore('葬送的芙莉莲', '葬送的芙莉莲')).toBeGreaterThan(titleMatchScore('葬送的芙莉莲', '葬送的芙莉莲 特别篇'));
    });
});
