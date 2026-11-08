import { bootstrap } from './bootstrap';
import { acquireBootGuard, releaseBootGuard } from './core/boot-guard';
import { logger } from './core/logger';

/**
 * 主入口
 * 检查是否在 Jellyfin 页面，然后启动
 */
(function main() {
    'use strict';

    // 守卫：检查是否在 Jellyfin 页面
    const appMeta = document.querySelector('meta[name="application-name"]');
    if (!appMeta || appMeta.getAttribute('content') !== 'Jellyfin') {
        return;
    }

    // 守卫：同一页面只启动一个实例。用户可能同时用 Tampermonkey 和反向代理注入，
    // 重复启动会挂两套按钮、观察器和弹幕引擎。
    if (!acquireBootGuard()) {
        logger.info('main', 'Jellyfin Danmaku Plugin already running; skip duplicate injection');
        return;
    }

    logger.info('main', 'Jellyfin Danmaku Plugin starting...');

    bootstrap()
        .then(() => {
            logger.info('main', 'Plugin initialized successfully');
        })
        .catch((error) => {
            releaseBootGuard();
            logger.error('main', 'Failed to initialize plugin', error);
        });
})();
