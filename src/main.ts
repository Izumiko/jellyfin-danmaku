import { bootstrap } from './bootstrap';
import { logger } from './core/logger';

/**
 * 主入口
 * 检查是否在 Jellyfin 页面，然后启动
 */
(async function main() {
    'use strict';

    // 守卫：检查是否在 Jellyfin 页面
    const appMeta = document.querySelector('meta[name="application-name"]');
    if (!appMeta || appMeta.getAttribute('content') !== 'Jellyfin') {
        return;
    }

    logger.info('main', 'Jellyfin Danmaku Plugin starting...');

    try {
        await bootstrap();
        logger.info('main', 'Plugin initialized successfully');
    } catch (error) {
        logger.error('main', 'Failed to initialize plugin', error);
    }
})();
