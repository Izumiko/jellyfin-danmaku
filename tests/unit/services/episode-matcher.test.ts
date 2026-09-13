import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EpisodeMatcher } from '@/services/episode-matcher';
import { Storage } from '@/core/storage';
import type { JellyfinItem, SearchResponse, EpisodeInfo } from '@/types/index';

// Mock Storage
vi.mock('@/core/storage', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/core/storage')>();
    return {
        ...actual,
        Storage: {
            getEpisodeCache: vi.fn(),
            setEpisodeCache: vi.fn(),
            getSeasonAnime: vi.fn(),
            setSeasonAnime: vi.fn(),
        },
    };
});

// Mock dandanplay client
vi.mock('@/services/dandanplay/client', () => ({
    searchEpisodes: vi.fn(),
    getAnimeById: vi.fn(),
}));

import { searchEpisodes, getAnimeById } from '@/services/dandanplay/client';

describe('EpisodeMatcher', () => {
    let matcher: EpisodeMatcher;
    const dialogs = {
        showInputDialog: vi.fn(async () => null as string | null),
        showSelectDialog: vi.fn(async () => null as number | null),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(Storage.getSeasonAnime).mockResolvedValue(null);
        vi.mocked(getAnimeById).mockResolvedValue(null);
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

        it('auto-matches by remembered animeId without searching titles', async () => {
            vi.mocked(Storage.getEpisodeCache).mockResolvedValue(null);
            vi.mocked(Storage.getSeasonAnime).mockResolvedValue({
                animeId: 19327,
                animeTitle: '女主角？圣女？不，我是杂役女仆（自豪）！',
            });
            vi.mocked(getAnimeById).mockResolvedValue({
                animeId: 19327,
                animeTitle: '女主角？圣女？不，我是杂役女仆（自豪）！',
                type: 'tvseries',
                episodes: [
                    { episodeId: 193270001, episodeTitle: '第1话 开始', episodeNumber: 1 },
                    { episodeId: 193270002, episodeTitle: '第2话 继续', episodeNumber: 2 },
                ],
            });

            const result = await matcher.match(createJellyfinItem({ IndexNumber: 2 }));

            expect(getAnimeById).toHaveBeenCalledWith('https://api.example.com', 19327);
            expect(searchEpisodes).not.toHaveBeenCalled();
            expect(result?.episodeId).toBe(193270002);
        });

        it('applies the learned episode offset to later episodes', async () => {
            vi.mocked(Storage.getEpisodeCache).mockResolvedValue(null);
            vi.mocked(Storage.getSeasonAnime).mockResolvedValue({
                animeId: 18211,
                animeTitle: 'Anime',
                episodeIndexOffset: 12,
            });
            vi.mocked(getAnimeById).mockResolvedValue({
                animeId: 18211,
                animeTitle: 'Anime',
                type: 'tvseries',
                episodes: Array.from({ length: 24 }, (_, i) => ({
                    episodeId: 182110000 + i + 1,
                    episodeTitle: `第${i + 1}话`,
                    episodeNumber: i + 1,
                })),
            });

            const result = await matcher.match(createJellyfinItem({ IndexNumber: 2 }));

            // Jellyfin 第2集 -> 下标 1 + 12 = 13 -> 第14话
            expect(result?.episodeId).toBe(182110014);
        });

        it('learns the episode offset from a manual selection', async () => {
            vi.mocked(Storage.getEpisodeCache).mockResolvedValue(null);
            vi.mocked(Storage.getSeasonAnime).mockResolvedValue(null);
            vi.mocked(searchEpisodes).mockResolvedValue({
                hasMore: false,
                animes: [
                    {
                        animeId: 7,
                        animeTitle: 'Anime 7',
                        type: 'tvseries',
                        episodes: Array.from({ length: 14 }, (_, i) => ({
                            episodeId: 700 + i + 1,
                            episodeTitle: `第${i + 1}话`,
                        })),
                    },
                ],
                errorCode: 0,
                errorMessage: '',
            });
            dialogs.showInputDialog.mockResolvedValue('Anime 7');
            dialogs.showSelectDialog.mockResolvedValueOnce(0).mockResolvedValueOnce(12);

            const result = await matcher.match(createJellyfinItem({ IndexNumber: 1 }), 'manual');

            expect(result?.episodeId).toBe(713);
            expect(Storage.setSeasonAnime).toHaveBeenCalledWith('season-1', {
                animeId: 7,
                animeTitle: 'Anime 7',
                episodeIndexOffset: 12,
            });
        });

        it('falls back to title search when animeId lookup fails', async () => {
            vi.mocked(Storage.getEpisodeCache).mockResolvedValue(null);
            vi.mocked(Storage.getSeasonAnime).mockResolvedValue({
                animeId: 2,
                animeTitle: 'Correct DDP Name',
            });
            vi.mocked(getAnimeById).mockResolvedValue(null);
            vi.mocked(searchEpisodes).mockResolvedValue(createSearchResponse(2));

            const result = await matcher.match(createJellyfinItem({ IndexNumber: 2 }));

            expect(searchEpisodes).toHaveBeenCalledWith('https://api.example.com', 'Correct DDP Name');
            expect(result?.animeTitle).toBe('Anime 2');
            expect(result?.episodeId).toBe(2);
        });

        it('does not use animeId in manual mode', async () => {
            vi.mocked(Storage.getEpisodeCache).mockResolvedValue(null);
            vi.mocked(Storage.getSeasonAnime).mockResolvedValue({
                animeId: 2,
                animeTitle: 'Correct DDP Name',
            });
            vi.mocked(searchEpisodes).mockResolvedValue(createSearchResponse(2));
            dialogs.showInputDialog.mockResolvedValue('Query Name');
            dialogs.showSelectDialog.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

            const result = await matcher.match(createJellyfinItem(), 'manual');

            expect(getAnimeById).not.toHaveBeenCalled();
            expect(result?.animeTitle).toBe('Anime 2');
        });

        it('saves season anime after manual select', async () => {
            vi.mocked(Storage.getEpisodeCache).mockResolvedValue(null);
            vi.mocked(searchEpisodes).mockResolvedValue(createSearchResponse(2));
            dialogs.showInputDialog.mockResolvedValue('Query Name');
            dialogs.showSelectDialog.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

            await matcher.match(createJellyfinItem(), 'manual');

            expect(Storage.setSeasonAnime).toHaveBeenCalledWith('season-1', {
                animeId: 2,
                animeTitle: 'Anime 2',
                episodeIndexOffset: 0,
            });
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
