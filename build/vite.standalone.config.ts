import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'node:path';

const rootDir = import.meta.dirname;

function inlineCss(): Plugin {
    return {
        name: 'inline-css',
        apply: 'build',
        enforce: 'post',
        generateBundle(_options, bundle) {
            let css = '';
            for (const [fileName, item] of Object.entries(bundle)) {
                if (item.type === 'asset' && fileName.endsWith('.css')) {
                    css += typeof item.source === 'string' ? item.source : new TextDecoder().decode(item.source);
                    delete bundle[fileName];
                }
            }
            if (!css) return;
            const inject = `!function(){var s=document.createElement("style");s.textContent=${JSON.stringify(css)};document.documentElement.appendChild(s)}();`;
            for (const item of Object.values(bundle)) {
                if (item.type === 'chunk' && item.isEntry) {
                    item.code = inject + item.code;
                }
            }
        },
    };
}

export default defineConfig({
    plugins: [svelte(), inlineCss()],
    resolve: {
        alias: {
            '@': path.resolve(rootDir, '../src'),
        },
    },
    build: {
        outDir: path.resolve(rootDir, '../dist'),
        emptyOutDir: true,
        sourcemap: true,
        lib: {
            entry: path.resolve(rootDir, '../src/main.ts'),
            name: 'JellyfinDanmaku',
            fileName: () => 'ede.min.js',
            formats: ['iife'],
        },
        minify: 'oxc',
    },
});
