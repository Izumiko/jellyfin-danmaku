import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import Sidebar from '@/ui/components/Sidebar.svelte';
import { danmakuState } from '@/core/state.svelte';
import { eventBus } from '@/core/event-bus';
import { DEFAULT_CONFIG } from '@/core/config';

describe('Sidebar', () => {
    let app: ReturnType<typeof mount>;
    let onClose: ReturnType<typeof vi.fn>;

    function openTab(label: string) {
        const tab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((el) => el.textContent?.trim() === label)!;
        tab.click();
        flushSync();
    }

    beforeEach(() => {
        eventBus.clear();
        danmakuState.hydrate();
        onClose = vi.fn();
        app = mount(Sidebar, { target: document.body, props: { onClose } });
        flushSync();
    });

    afterEach(() => {
        unmount(app);
        document.body.innerHTML = '';
        eventBus.clear();
    });

    it('applies slider changes immediately and persists them without a save button', () => {
        const changed = vi.fn();
        eventBus.on('settings:changed', changed);
        openTab('显示');

        const slider = [...document.querySelectorAll<HTMLInputElement>('input[type="range"]')][1]; // 字号
        slider.value = '30';
        slider.dispatchEvent(new Event('input', { bubbles: true }));

        expect(danmakuState.fontSize).toBe(30);
        expect(JSON.parse(localStorage.getItem('jellyfin_danmaku_config')!).fontSize).toBe(30);
        expect(changed).toHaveBeenCalledWith({ keys: ['fontSize'] });
        expect(document.body.textContent).not.toContain('保存');
    });

    it('restores display defaults without touching filters', () => {
        danmakuState.update({ fontSize: 40, sourceFilter: { bilibili: false, gamer: true, dandanplay: true, other: true } });
        openTab('显示');

        [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === '恢复默认')!.click();

        expect(danmakuState.fontSize).toBe(DEFAULT_CONFIG.fontSize);
        expect(danmakuState.sourceFilter.bilibili).toBe(false);
    });

    it('toggles a source filter chip', () => {
        openTab('过滤');
        const chip = [...document.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find((b) => b.textContent?.includes('B站'))!;
        expect(chip.getAttribute('aria-pressed')).toBe('true');

        chip.click();
        flushSync();

        expect(danmakuState.sourceFilter.bilibili).toBe(false);
        expect(chip.getAttribute('aria-pressed')).toBe('false');
    });

    it('nudges the per-episode offset with rounding', () => {
        danmakuState.curEpOffset = 0;
        openTab('当前视频');
        const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label)!;

        button('+0.1').click();
        button('+0.1').click();
        button('+0.1').click();

        expect(danmakuState.curEpOffset).toBe(0.3);
    });

    it('closes on Escape and keeps the key away from player hotkeys', () => {
        const documentListener = vi.fn();
        document.addEventListener('keydown', documentListener);
        const panel = document.querySelector('[aria-label="弹幕设置"]')!;

        panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        panel.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(documentListener).not.toHaveBeenCalled();
        document.removeEventListener('keydown', documentListener);
    });
});
