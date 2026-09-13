import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

export default defineConfig({
    plugins: [svelte({ hot: false })],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
        conditions: process.env.VITEST ? ['browser'] : undefined,
    },
    test: {
        exclude: ['**/node_modules/**', '**/another-version/**', '**/dist/**'],
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./tests/setup.ts'],
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: ['src/types/**', 'src/**/*.d.ts', 'src/**/*.svelte'],
        },
    },
});
