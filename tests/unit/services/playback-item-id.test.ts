import { describe, it, expect, vi, afterEach } from 'vitest';
import { interceptPlaybackInfo, itemIdFromUrl } from '@/services/jellyfin/interceptor';

const ID = '0d74e8742f22d4deaaf84490feda962d';
const UUID = '0d74e874-2f22-d4de-aaf8-4490feda962d';

describe('itemIdFromUrl', () => {
    it('extracts the item id from PlaybackInfo, stream and HLS urls', () => {
        expect(itemIdFromUrl(`https://jf.example/Items/${ID}/PlaybackInfo?userId=1`)).toBe(ID);
        expect(itemIdFromUrl(`https://jf.example/Videos/${ID}/stream.mkv?static=true`)).toBe(ID);
        expect(itemIdFromUrl(`https://jf.example/jellyfin/Videos/${ID}/master.m3u8?MediaSourceId=x`)).toBe(ID);
        expect(itemIdFromUrl(`https://jf.example/Videos/${UUID}/main.m3u8`)).toBe(ID);
    });

    it('ignores unrelated item urls', () => {
        expect(itemIdFromUrl(`https://jf.example/Items/${ID}`)).toBeNull();
        expect(itemIdFromUrl(`https://jf.example/Items/${ID}/Images/Primary`)).toBeNull();
        expect(itemIdFromUrl('https://jf.example/Items/abc-123/PlaybackInfo')).toBeNull();
    });
});

describe('interceptPlaybackInfo', () => {
    let cleanup: (() => void) | undefined;

    afterEach(() => {
        cleanup?.();
        cleanup = undefined;
    });

    it('captures ids from fetch, XHR and video loadstart, reporting only changes', async () => {
        const originalFetch = window.fetch;
        const pageFetch = vi.fn().mockResolvedValue(new Response('{}'));
        window.fetch = pageFetch;
        const onItemId = vi.fn();
        cleanup = interceptPlaybackInfo(onItemId);

        await window.fetch(`/Items/${ID}/PlaybackInfo`, { method: 'POST' });
        await window.fetch(new Request(`http://localhost/Videos/${ID}/stream`));

        const xhr = new XMLHttpRequest();
        xhr.open('GET', `/Videos/${UUID.replace('d4de', 'ffff')}/master.m3u8`);

        const video = document.createElement('video');
        document.body.appendChild(video);
        Object.defineProperty(video, 'currentSrc', { value: `http://localhost/Videos/${ID}/stream.mp4` });
        video.dispatchEvent(new Event('loadstart'));

        expect(onItemId.mock.calls.map((c) => c[0])).toEqual([ID, '0d74e8742f22ffffaaf84490feda962d', ID]);

        expect(pageFetch).toHaveBeenCalledTimes(2);

        cleanup();
        cleanup = undefined;
        expect(window.fetch).toBe(pageFetch);
        video.remove();
        window.fetch = originalFetch;
    });
});
