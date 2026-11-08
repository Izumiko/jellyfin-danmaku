import { describe, it, expect } from 'vitest';
import { acquireBootGuard, releaseBootGuard } from '@/core/boot-guard';

describe('boot guard', () => {
    it('allows only the first injection to boot', () => {
        const target = {} as Window;

        expect(acquireBootGuard(target)).toBe(true);
        expect(acquireBootGuard(target)).toBe(false);
    });

    it('releases the guard after a failed bootstrap so a later injection can retry', () => {
        const target = {} as Window;

        expect(acquireBootGuard(target)).toBe(true);
        releaseBootGuard(target);
        expect(acquireBootGuard(target)).toBe(true);
    });
});
