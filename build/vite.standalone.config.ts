import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

export default defineConfig({
    plugins: [svelte()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, '../src'),
        },
    },
    build: {
        outDir: './dist',
        lib: {
            entry: path.resolve(__dirname, '../src/main.ts'),
            name: 'JellyfinDanmaku',
            fileName: 'ede.min',
            formats: ['iife'],
        },
        rollupOptions: {
            output: {
                inlineDynamicImports: true,
            },
        },
        minify: 'esbuild',
    },
});
