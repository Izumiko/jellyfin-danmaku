import { mount } from 'svelte';
import { detectJellyfinVersion, getCurrentItem, waitForApiClient } from './services/jellyfin/client';
import { interceptPlaybackInfo } from './services/jellyfin/interceptor';
import { danmakuState } from './core/state.svelte';
import { eventBus } from './core/event-bus';
import { logger } from './core/logger';
import { DisposableStore } from './utils/disposable';
import { waitForElement } from './utils/dom';
import { SELECTORS } from './core/config';
import { EpisodeMatcher } from './services/episode-matcher';
import { CommentFetcher } from './services/comment-fetcher';
import { danmakuEngine } from './danmaku/engine';
import DanmakuToggle from './ui/components/DanmakuToggle.svelte';
import Sidebar from './ui/components/Sidebar.svelte';

/**
 * 生命周期编排
 */
export async function bootstrap() {
    const disposables = new DisposableStore();

    try {
        // 1. 等待 ApiClient 就绪
        await waitForApiClient();

        // 2. 检测 Jellyfin 版本
        const { isNewJellyfin } = detectJellyfinVersion();
        danmakuState.isNewJellyfin = isNewJellyfin;

        // 3. 安装 XHR 拦截器
        const cleanupInterceptor = interceptPlaybackInfo((id) => {
            danmakuState.itemId = id;
            logger.debug('bootstrap', `Item ID captured: ${id}`);
        });
        disposables.add(cleanupInterceptor);

        // 4. 等待视频播放器
        const videoPlayer = await waitForElement(SELECTORS.videoPlayer, { timeout: 30000 });
        logger.info('bootstrap', 'Video player detected');

        // 5. 等待控制栏
        const controlBar = await waitForElement(SELECTORS.pauseButton, { timeout: 10000 });
        logger.info('bootstrap', 'Control bar detected');

        // 6. 挂载 UI 组件
        const toggleContainer = document.createElement('div');
        toggleContainer.style.display = 'inline-flex';
        controlBar.parentElement?.insertBefore(toggleContainer, controlBar.nextSibling);

        const toggleApp = mount(DanmakuToggle, {
            target: toggleContainer,
            props: {
                visible: danmakuState.danmakuSwitch,
            },
        });

        // 7. 设置侧边栏
        let sidebarOpen = false;
        let sidebarApp: any = null;

        const openSidebar = () => {
            if (sidebarOpen) return;

            const sidebarContainer = document.createElement('div');
            document.body.appendChild(sidebarContainer);

            sidebarApp = mount(Sidebar, {
                target: sidebarContainer,
                props: {
                    open: true,
                    onSave: () => {
                        danmakuState.persist();
                        sidebarOpen = false;
                        sidebarApp = null;
                        sidebarContainer.remove();
                        eventBus.emit('danmaku:reload', { reason: 'settings-changed' });
                    },
                    onCancel: () => {
                        danmakuState.hydrate();
                        sidebarOpen = false;
                        sidebarApp = null;
                        sidebarContainer.remove();
                    },
                },
            });

            sidebarOpen = true;
        };

        // 监听设置打开事件
        const unsubSettings = eventBus.on('settings:open', openSidebar);
        disposables.add(unsubSettings);

        // 8. 注入 Jellyfin 菜单
        setupMenuInjection(disposables);

        // 9. 监听弹幕重载事件
        const unsubReload = eventBus.on('danmaku:reload', async (data) => {
            await loadDanmaku(data.reason);
        });
        disposables.add(unsubReload);

        // 10. 初始加载弹幕
        await loadDanmaku('init');

        logger.info('bootstrap', 'Bootstrap completed');
    } catch (error) {
        logger.error('bootstrap', 'Bootstrap failed', error);
        throw error;
    }

    return () => {
        disposables.dispose();
    };
}

/**
 * 加载弹幕
 */
async function loadDanmaku(reason: string) {
    if (danmakuState.loading) {
        logger.debug('loadDanmaku', 'Already loading, skipping');
        return;
    }

    danmakuState.loading = true;

    try {
        logger.info('loadDanmaku', `Loading danmaku (reason: ${reason})`);

        // 1. 获取当前媒体项
        const item = await getCurrentItem(danmakuState.isNewJellyfin, danmakuState.itemId);
        if (!item) {
            logger.warn('loadDanmaku', 'No current item');
            return;
        }

        // 2. 匹配剧集
        const matcher = new EpisodeMatcher({
            apiPrefix: danmakuState.effectiveApiPrefix,
            chConvert: danmakuState.chConvert,
        });

        const episodeInfo = await matcher.match(item, reason === 'search' ? 'manual' : 'auto');
        if (!episodeInfo) {
            logger.warn('loadDanmaku', 'No episode matched');
            return;
        }

        danmakuState.episodeInfo = episodeInfo;

        // 3. 获取弹幕
        const fetcher = new CommentFetcher({
            apiPrefix: danmakuState.effectiveApiPrefix,
            chConvert: danmakuState.chConvert,
            sourceFilter: danmakuState.sourceFilter,
            useXmlDanmaku: danmakuState.useXmlDanmaku,
        });

        const comments = await fetcher.fetch(episodeInfo.episodeId, item.Id);

        // 4. 初始化弹幕引擎
        const video = document.querySelector('video');
        const container = document.querySelector(SELECTORS.mediaContainer);

        if (video && container) {
            danmakuEngine.init(
                {
                    container: container as HTMLElement,
                    media: video,
                    comments: [],
                    speed: danmakuState.speed,
                    opacity: danmakuState.opacity,
                    heightRatio: danmakuState.heightRatio,
                    visible: danmakuState.danmakuSwitch,
                },
                comments,
            );

            eventBus.emit('danmaku:loaded', { count: comments.length, source: 'online' });
        }
    } catch (error) {
        logger.error('loadDanmaku', 'Failed to load danmaku', error);
        eventBus.emit('danmaku:error', { error: error as Error, source: 'loadDanmaku' });
    } finally {
        danmakuState.loading = false;
    }
}

/**
 * 设置 Jellyfin 菜单注入
 */
function setupMenuInjection(disposables: DisposableStore) {
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (!(node instanceof HTMLElement)) continue;

                const actionSheet = node.classList.contains('actionSheet')
                    ? node
                    : node.querySelector('.actionSheet');

                if (!actionSheet) continue;
                if (!actionSheet.querySelector('[data-id="aspectratio"]')) continue;
                if (!actionSheet.querySelector('[data-id="playbackrate"]')) continue;

                injectSettingsMenuItem(actionSheet);
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    disposables.add(() => observer.disconnect());
}

/**
 * 注入设置菜单项
 */
function injectSettingsMenuItem(actionSheet: Element) {
    if (actionSheet.querySelector('[data-id="danmaku-settings"]')) return;

    const menuItem = document.createElement('button');
    menuItem.setAttribute('data-id', 'danmaku-settings');
    menuItem.className = 'btnDanmakuSettings listItem listItem-button actionSheetMenuItem';
    menuItem.type = 'button';
    menuItem.innerHTML = `
        <span class="actionsheetMenuItemIcon listItemIcon listItemIcon-transparent material-icons">comment</span>
        <div class="listItemBody actionsheetListItemBody">
            <div class="listItemBodyText actionSheetItemText">弹幕设置</div>
        </div>
    `;

    menuItem.addEventListener('click', () => {
        const closeBtn = actionSheet.closest('.dialogContainer')?.querySelector('.btnCloseActionSheet');
        (closeBtn as HTMLElement)?.click();
        eventBus.emit('settings:open', undefined);
    });

    actionSheet.appendChild(menuItem);
}
