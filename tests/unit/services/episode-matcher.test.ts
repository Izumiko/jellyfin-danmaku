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
    const dialogs = {
        showInputDialog: vi.fn(async () => null as string | null),
        showSelectDialog: vi.fn(async () => null as number | null),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        matcher = new EpisodeMatcher({
            apiPrefix: 'https://api.example.com',
            chConvert: 0,
            ...dialogs,
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

            vi.mocked(Storage.getEpisodeCache).mockResolvedValue({
                ...cached,
                timestamp: Date.now(),
            });

            const item = createJellyfinItem();
            const result = await matcher.match(item);

            expect(result).toEqual(cached);
            expect(searchEpisodes).not.toHaveBeenCalled();
        });

        it('should search and auto-select first anime', async () => {
            vi.mocked(Storage.getEpisodeCache).mockResolvedValue(null);
            vi.mocked(searchEpisodes).mockResolvedValue(createSearchResponse(2));

            const item = createJellyfinItem({ IndexNumber: 1 });
            const result = await matcher.match(item);

            expect(result).not.toBeNull();
            expect(result?.animeTitle).toBe('Anime 1');
            expect(searchEpisodes).toHaveBeenCalledWith('https://api.example.com', 'Test Anime Series');
        });

        it('should retry with OriginalTitle when no results', async () => {
            vi.mocked(Storage.getEpisodeCache).mockResolvedValue(null);
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
            vi.mocked(Storage.getEpisodeCache).mockResolvedValue(null);
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
            vi.mocked(Storage.getEpisodeCache).mockResolvedValue(null);
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

        it('skips cache in manual mode and uses dialogs', async () => {
            vi.mocked(Storage.getEpisodeCache).mockResolvedValue({
                episodeId: 999,
                animeTitle: 'Cached',
                episodeTitle: 'Cached Ep',
                timestamp: Date.now(),
            });
            vi.mocked(searchEpisodes).mockResolvedValue(createSearchResponse(2));
            dialogs.showInputDialog.mockResolvedValue('Query Name');
            dialogs.showSelectDialog
                .mockResolvedValueOnce(1) // anime
                .mockResolvedValueOnce(2); // episode index

            const result = await matcher.match(createJellyfinItem(), 'manual');
            expect(Storage.getEpisodeCache).not.toHaveBeenCalled();
            expect(searchEpisodes).toHaveBeenCalledWith('https://api.example.com', 'Query Name');
            expect(result?.animeTitle).toBe('Anime 2');
            expect(result?.episodeId).toBe(3);
        });

        it('returns null when input dialog cancelled', async () => {
            vi.mocked(Storage.getEpisodeCache).mockResolvedValue(null);
            dialogs.showInputDialog.mockResolvedValue(null);
            const result = await matcher.match(createJellyfinItem(), 'manual');
            expect(result).toBeNull();
            expect(searchEpisodes).not.toHaveBeenCalled();
        });

        it('appends season number when ParentIndexNumber > 1', async () => {
            vi.mocked(Storage.getEpisodeCache).mockResolvedValue(null);
            vi.mocked(searchEpisodes).mockResolvedValue(createSearchResponse(1));
            await matcher.match(createJellyfinItem({ ParentIndexNumber: 2 }));
            expect(searchEpisodes).toHaveBeenCalledWith('https://api.example.com', 'Test Anime Series2');
        });

        it('uses 第N话 offset for auto episode index', async () => {
            vi.mocked(Storage.getEpisodeCache).mockResolvedValue(null);
            vi.mocked(searchEpisodes).mockResolvedValue({
                hasMore: false,
                animes: [
                    {
                        animeId: 1,
                        animeTitle: 'Anime 1',
                        type: 'tvseries',
                        episodes: [
                            { episodeId: 10, episodeTitle: '第3话 开始' },
                            { episodeId: 11, episodeTitle: '第4话 继续' },
                        ],
                    },
                ],
                errorCode: 0,
                errorMessage: '',
            });
            const result = await matcher.match(createJellyfinItem({ IndexNumber: 4 }));
            expect(result?.episodeId).toBe(11);
        });
    });
});
