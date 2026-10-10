import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import monkey from 'vite-plugin-monkey';
import path from 'node:path';
import pkg from '../package.json' with { type: 'json' };

const rootDir = import.meta.dirname;
const updateUrl = 'https://cdn.jsdelivr.net/gh/Izumiko/jellyfin-danmaku@gh-pages/ede.user.js';

export default defineConfig({
    plugins: [
        svelte(),
        monkey({
            entry: path.resolve(rootDir, '../src/main.ts'),
            userscript: {
                // name + namespace 与 ede.js 保持一致：脚本管理器以此识别同一脚本，老用户才能原地升级。
                name: 'Jellyfin danmaku extension',
                namespace: 'https://github.com/RyoLee',
                version: pkg.version,
                description: 'Jellyfin弹幕插件',
                author: 'RyoLee, Izumiko',
                copyright: '2022, RyoLee (https://github.com/RyoLee)',
                license: 'MIT; https://raw.githubusercontent.com/Izumiko/jellyfin-danmaku/jellyfin/LICENSE',
                icon: 'https://github.githubassets.com/pinned-octocat.svg',
                updateURL: updateUrl,
                downloadURL: updateUrl,
                match: ['*://*/*/web/index.html', '*://*/web/index.html', '*://*/*/web/', '*://*/web/', 'https://jellyfin-web.pages.dev/'],
                connect: ['*'],
                // 必须运行在页面上下文：需要访问 window.ApiClient 并改写页面的 XMLHttpRequest。
                // 任何 GM_* 授权都会让脚本管理器进入沙箱，拦截器和 ApiClient 将失效。
                grant: 'none',
            },
            build: {
                autoGrant: false,
                // 不依赖 GM_addStyle，保证同一份产物也能被 <script> 标签直接引用。
                cssSideEffects: (css: string) => {
                    const style = document.createElement('style');
                    style.textContent = css;
                    (document.head || document.documentElement).appendChild(style);
                },
            },
        }),
    ],
    resolve: {
        alias: {
            '@': path.resolve(rootDir, '../src'),
        },
    },
    build: {
        outDir: path.resolve(rootDir, '../dist'),
        emptyOutDir: false,
        sourcemap: true,
    },
});
