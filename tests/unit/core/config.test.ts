import { describe, it, expect } from 'vitest';
import { validateConfigValue, mergeConfig, DEFAULT_CONFIG } from '@/core/config';

describe('config', () => {
    describe('validateConfigValue', () => {
        it('should clamp opacity to [0, 1]', () => {
            expect(validateConfigValue('opacity', -0.5)).toBe(0);
            expect(validateConfigValue('opacity', 1.5)).toBe(1);
            expect(validateConfigValue('opacity', 0.7)).toBe(0.7);
        });

        it('should clamp speed to [50, 600]', () => {
            expect(validateConfigValue('speed', 10)).toBe(50);
            expect(validateConfigValue('speed', 1000)).toBe(600);
            expect(validateConfigValue('speed', 200)).toBe(200);
        });

        it('should clamp fontSize to [10, 60]', () => {
            expect(validateConfigValue('fontSize', 5)).toBe(10);
            expect(validateConfigValue('fontSize', 100)).toBe(60);
            expect(validateConfigValue('fontSize', 18)).toBe(18);
        });

        it('should clamp heightRatio to [0.1, 1.0]', () => {
            expect(validateConfigValue('heightRatio', 0)).toBe(0.1);
            expect(validateConfigValue('heightRatio', 2)).toBe(1.0);
            expect(validateConfigValue('heightRatio', 0.9)).toBe(0.9);
        });
    });

    describe('mergeConfig', () => {
        it('should merge partial config with defaults', () => {
            const partial = { opacity: 0.5, speed: 300 };
            const merged = mergeConfig(partial);

            expect(merged.opacity).toBe(0.5);
            expect(merged.speed).toBe(300);
            expect(merged.fontSize).toBe(DEFAULT_CONFIG.fontSize);
        });

        it('should deep merge sourceFilter', () => {
            const partial = { sourceFilter: { bilibili: false } };
            const merged = mergeConfig(partial);

            expect(merged.sourceFilter.bilibili).toBe(false);
            expect(merged.sourceFilter.gamer).toBe(DEFAULT_CONFIG.sourceFilter.gamer);
        });

        it('should deep merge modeFilter', () => {
            const partial = { modeFilter: { scroll: false } };
            const merged = mergeConfig(partial);

            expect(merged.modeFilter.scroll).toBe(false);
            expect(merged.modeFilter.top).toBe(DEFAULT_CONFIG.modeFilter.top);
        });
    });
});
