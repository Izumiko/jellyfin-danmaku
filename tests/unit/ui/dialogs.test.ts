import { describe, it, expect } from 'vitest';
import { showInputDialog, showSelectDialog } from '@/ui/dialogs';

describe('dialogs', () => {
    it('resolves input on confirm', async () => {
        const pending = showInputDialog('标题', '占位', '默认');
        const input = document.querySelector('input') as HTMLInputElement;
        expect(input.value).toBe('默认');
        const confirm = document.querySelector('[data-action="confirm"]') as HTMLButtonElement;
        confirm.click();
        await expect(pending).resolves.toBe('默认');
        expect(document.querySelector('[data-dialog="input"]')).toBeNull();
    });

    it('resolves null on cancel', async () => {
        const pending = showInputDialog('标题', '', '');
        (document.querySelector('[data-action="cancel"]') as HTMLButtonElement).click();
        await expect(pending).resolves.toBeNull();
    });

    it('resolves null when Escape is pressed on focused input', async () => {
        const pending = showInputDialog('标题', '', '默认');
        const input = document.querySelector('input') as HTMLInputElement;
        input.focus();
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await expect(pending).resolves.toBeNull();
    });

    it('input dialog input has autofocus', async () => {
        const pending = showInputDialog('标题', '', '');
        const input = document.querySelector('[data-dialog="input"] input') as HTMLInputElement;
        expect(input.hasAttribute('autofocus')).toBe(true);
        (document.querySelector('[data-action="cancel"]') as HTMLButtonElement).click();
        await pending;
    });

    it('Escape on input dialog stops immediate propagation', async () => {
        const pending = showInputDialog('标题', '', '');
        let laterHeard = false;
        const later = () => {
            laterHeard = true;
        };
        window.addEventListener('keydown', later);
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        window.removeEventListener('keydown', later);
        await expect(pending).resolves.toBeNull();
        expect(laterHeard).toBe(false);
    });

    it('Escape on select dialog stops immediate propagation', async () => {
        const pending = showSelectDialog('选', ['A', 'B'], 0);
        let laterHeard = false;
        const later = () => {
            laterHeard = true;
        };
        window.addEventListener('keydown', later);
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        window.removeEventListener('keydown', later);
        await expect(pending).resolves.toBeNull();
        expect(laterHeard).toBe(false);
    });

    it('resolves selected index', async () => {
        const pending = showSelectDialog('选', ['A', 'B'], 1);
        const options = document.querySelectorAll('[data-action="option"]');
        expect(options).toHaveLength(2);
        (options[0] as HTMLButtonElement).click();
        await expect(pending).resolves.toBe(0);
    });
});
