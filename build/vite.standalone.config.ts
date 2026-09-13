import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'node:path';

const rootDir = import.meta.dirname;

export default defineConfig({
    plugins: [svelte()],
    resolve: {
        alias: {
            '@': path.resolve(rootDir, '../src'),
        },
    },
    build: {
        outDir: path.resolve(rootDir, '../dist'),
        emptyOutDir: true,
        lib: {
            entry: path.resolve(rootDir, '../src/main.ts'),
            name: 'JellyfinDanmaku',
            fileName: 'ede.min',
            formats: ['iife'],
        },
        minify: 'oxc',
    },
});
