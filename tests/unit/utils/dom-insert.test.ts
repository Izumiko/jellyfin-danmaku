import { describe, it, expect } from 'vitest';
import { insertBeforeRef } from '@/utils/dom';

describe('insertBeforeRef', () => {
    it('inserts before a nested reference using the reference parent', () => {
        const sheet = document.createElement('div');
        const scroller = document.createElement('div');
        const repeat = document.createElement('button');
        repeat.setAttribute('data-id', 'repeatmode');
        scroller.appendChild(repeat);
        sheet.appendChild(scroller);

        const item = document.createElement('button');
        insertBeforeRef(sheet, item, repeat);

        expect(repeat.parentElement).toBe(scroller);
        expect([...scroller.children]).toEqual([item, repeat]);
    });

    it('appends to container when reference is missing', () => {
        const sheet = document.createElement('div');
        const item = document.createElement('button');
        insertBeforeRef(sheet, item, null);
        expect(sheet.lastChild).toBe(item);
    });
});
