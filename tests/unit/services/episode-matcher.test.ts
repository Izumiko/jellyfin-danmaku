import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EpisodeMatcher } from '@/services/episode-matcher';
import { Storage } from '@/core/storage';
import type { JellyfinItem, SearchResponse, EpisodeInfo } from '@/types/index';

// Mock Storage
vi.mock('@/core/storage', () => ({
    Storage: {
        getEpisodeCache: vi.fn(),
        setEpisodeCache: vi.fn(),
    },
}));

// Mock dandanplay client
vi.mock('@/services/dandanplay/client', () => ({
    searchEpisodes: vi.fn(),
}));

import { searchEpisodes } from '@/services/dandanplay/client';

describe('EpisodeMatcher', () => {
    let matcher: EpisodeMatcher;

    beforeEach(() => {
        vi.clearAllMocks();
        matcher = new EpisodeMatcher({
            apiPrefix: 'https://api.example.com',
            chConvert: 0,
        });
    });

    const createJellyfinItem = (overrides: Partial<JellyfinItem> = {}): JellyfinItem => ({
        Id: 'item-123',
        Name: 'Test Anime',
        SeriesName: 'Test Anime Series',
        SeasonId: 'season-1',
        IndexNumber: 1,
        ParentIndexNumber: 1,
        OriginalTitle: 'テストアニメ',
        ...overrides,
    });

    const createSearchResponse = (animeCount: number = 1): SearchResponse => ({
        hasMore: false,
        animes: Array.from({ length: animeCount }, (_, i) => ({
            animeId: i + 1,
            animeTitle: `Anime ${i + 1}`,
            type: 'tvseries',
            episodes: Array.from({ length: 12 }, (_, j) => ({
                episodeId: j + 1,
                episodeTitle: `第${j + 1}集`,
            })),
        })),
        errorCode: 0,
        errorMessage: '',
    });

    describe('match', () => {
        it('should return cached episode if available', async () => {
            const cached: EpisodeInfo = {
                episodeId: 123,
                animeTitle: 'Cached Anime',
                episodeTitle: 'Episode 1',
            };

            vi.mocked(Storage.getEpisodeCache).mockReturnValue({
                ...cached,
                timestamp: Date.now(),
            });

            const item = createJellyfinItem();
            const result = await matcher.match(item);

            expect(result).toEqual(cached);
            expect(searchEpisodes).not.toHaveBeenCalled();
        });

        it('should search and auto-select first anime', async () => {
            vi.mocked(Storage.getEpisodeCache).mockReturnValue(null);
            vi.mocked(searchEpisodes).mockResolvedValue(createSearchResponse(2));

            const item = createJellyfinItem({ IndexNumber: 1 });
            const result = await matcher.match(item);

            expect(result).not.toBeNull();
            expect(result?.animeTitle).toBe('Anime 1');
            expect(searchEpisodes).toHaveBeenCalledWith('https://api.example.com', 'Test Anime Series');
        });

        it('should retry with OriginalTitle when no results', async () => {
            vi.mocked(Storage.getEpisodeCache).mockReturnValue(null);
            vi.mocked(searchEpisodes)
                .mockResolvedValueOnce({
                    hasMore: false,
                    animes: [],
                    errorCode: 0,
                    errorMessage: '',
                })
                .mockResolvedValueOnce(createSearchResponse(1));

            const item = createJellyfinItem({ OriginalTitle: 'テストアニメ' });
            const result = await matcher.match(item);

            expect(result).not.toBeNull();
            expect(searchEpisodes).toHaveBeenCalledTimes(2);
            expect(searchEpisodes).toHaveBeenLastCalledWith('https://api.example.com', 'テストアニメ');
        });

        it('should return null when no anime found', async () => {
            vi.mocked(Storage.getEpisodeCache).mockReturnValue(null);
            vi.mocked(searchEpisodes).mockResolvedValue({
                hasMore: false,
                animes: [],
                errorCode: 0,
                errorMessage: '',
            });

            const item = createJellyfinItem();
            const result = await matcher.match(item);

            expect(result).toBeNull();
        });

        it('should cache successful match', async () => {
            vi.mocked(Storage.getEpisodeCache).mockReturnValue(null);
            vi.mocked(searchEpisodes).mockResolvedValue(createSearchResponse(1));

            const item = createJellyfinItem({ SeasonId: 'season-1', IndexNumber: 1 });
            await matcher.match(item);

            expect(Storage.setEpisodeCache).toHaveBeenCalledWith(
                'season-1',
                1,
                expect.objectContaining({
                    episodeId: expect.any(Number),
                    animeTitle: 'Anime 1',
                }),
            );
        });
    });
});
