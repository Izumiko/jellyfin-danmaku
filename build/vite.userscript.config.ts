import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import monkey from 'vite-plugin-monkey';
import path from 'path';

export default defineConfig({
    plugins: [
        svelte(),
        monkey({
            entry: path.resolve(__dirname, '../src/main.ts'),
            userscript: {
                name: 'Jellyfin Danmaku',
                namespace: 'jellyfin-danmaku',
                version: '2.0.0',
                description: 'Jellyfin 弹幕插件 - TypeScript + Svelte 5 重构版',
                author: 'RyoLee, Izumiko',
                match: ['*://*/*/web/index.html', '*://*/web/index.html', '*://*/*/web/', '*://*/web/', 'https://jellyfin-web.pages.dev/'],
                icon: 'https://github.com/nicedayzhu/jellyfin-danmaku/raw/jellyfin/Newlogo.ico',
                connect: ['*'],
            },
        }),
    ],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, '../src'),
        },
    },
    build: {
        outDir: './dist',
    },
});
