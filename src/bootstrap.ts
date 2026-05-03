import { mount, unmount } from 'svelte';
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
import DebugOverlay from './ui/components/DebugOverlay.svelte';

/**
 * 全局插件状态
 */
let pluginActive = false;
let playerDisposables: DisposableStore | null = null;
let menuInjectionCleanup: (() => void) | null = null;
let sidebarOpen = false;
let sidebarApp: ReturnType<typeof mount> | null = null;
let sidebarContainer: HTMLDivElement | null = null;
let toggleApp: ReturnType<typeof mount> | null = null;
let toggleContainer: HTMLDivElement | null = null;
let debugApp: ReturnType<typeof mount> | null = null;
let debugContainer: HTMLDivElement | null = null;

/**
 * 主入口 - 监听播放器生命周期
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

        // 4. 监听播放器生命周期
        const cleanupLifecycle = observePlayerLifecycle();
        disposables.add(cleanupLifecycle);

        // 5. 注入 Jellyfin 菜单（全局只需一次）
        menuInjectionCleanup = setupMenuInjection();

        // 6. 监听弹幕重载事件
        const unsubReload = eventBus.on('danmaku:reload', async (data) => {
            if (pluginActive) {
                await loadDanmaku(data.reason);
            }
        });
        disposables.add(unsubReload);

        // 7. 监听视频源变更（切集）
        const unsubSourceChange = eventBus.on('media:source-changed', async () => {
            if (pluginActive) {
                logger.info('bootstrap', 'Media source changed, reloading danmaku in 2s');
                await new Promise((resolve) => setTimeout(resolve, 2000));
                await loadDanmaku('refresh');
            }
        });
        disposables.add(unsubSourceChange);

        logger.info('bootstrap', 'Bootstrap completed, watching for video player');
    } catch (error) {
        logger.error('bootstrap', 'Bootstrap failed', error);
        throw error;
    }

    return () => {
        disposables.dispose();
        menuInjectionCleanup?.();
        cleanupPlayer();
    };
}

/**
 * 监听播放器生命周期
 * 检测 .videoPlayerContainer 的添加和移除
 */
function observePlayerLifecycle(): () => void {
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            // 检测移除
            for (const node of mutation.removedNodes) {
                if (node instanceof HTMLElement && node.classList?.contains('videoPlayerContainer')) {
                    logger.info('lifecycle', 'Video player removed');
                    cleanupPlayer();
                    eventBus.emit('media:removed', undefined);
                    return;
                }
            }

            // 检测添加
            for (const node of mutation.addedNodes) {
                if (node instanceof HTMLElement) {
                    const isVideoContainer = node.classList?.contains('videoPlayerContainer');
                    const hasVideoContainer = node.querySelector?.('.videoPlayerContainer');

                    if (isVideoContainer || hasVideoContainer) {
                        logger.info('lifecycle', 'Video player added');
                        initPlayer();
                        return;
                    }
                }
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // 检查当前是否已经有播放器
    if (document.querySelector('.videoPlayerContainer')) {
        logger.info('lifecycle', 'Video player already exists');
        initPlayer();
    }

    return () => observer.disconnect();
}

/**
 * 初始化播放器相关的 UI 和弹幕
 */
async function initPlayer() {
    if (pluginActive) {
        logger.debug('lifecycle', 'Player already active, skipping init');
        return;
    }

    pluginActive = true;
    playerDisposables = new DisposableStore();

    try {
        // 等待控制栏
        const controlBar = await waitForElement(SELECTORS.pauseButton, { timeout: 10000 });
        logger.info('lifecycle', 'Control bar detected');

        // 挂载弹幕开关
        toggleContainer = document.createElement('div');
        toggleContainer.style.display = 'inline-flex';
        controlBar.parentElement?.insertBefore(toggleContainer, controlBar.nextSibling);

        toggleApp = mount(DanmakuToggle, {
            target: toggleContainer,
        });

        // 挂载调试浮层
        const videoContainer = document.querySelector(SELECTORS.mediaContainer);
        if (videoContainer instanceof HTMLElement) {
            debugContainer = document.createElement('div');
            debugContainer.style.position = 'absolute';
            debugContainer.style.zIndex = '99';
            debugContainer.style.right = '50px';
            debugContainer.style.top = '50px';
            videoContainer.appendChild(debugContainer);

            debugApp = mount(DebugOverlay, {
                target: debugContainer,
            });
        }

        // 初始加载弹幕
        await loadDanmaku('init');

        logger.info('lifecycle', 'Player initialization completed');
    } catch (error) {
        logger.error('lifecycle', 'Failed to initialize player', error);
        cleanupPlayer();
    }
}

/**
 * 清理播放器相关资源
 */
function cleanupPlayer() {
    if (!pluginActive) return;

    logger.info('lifecycle', 'Cleaning up player resources');

    // 销毁引擎
    danmakuEngine.destroy();

    // 清理 UI
    if (toggleApp) {
        try {
            unmount(toggleApp);
        } catch {
            // ignore cleanup errors
        }
        toggleApp = null;
    }
    if (toggleContainer) {
        toggleContainer.remove();
        toggleContainer = null;
    }

    if (debugApp) {
        try {
            unmount(debugApp);
        } catch {
            // ignore cleanup errors
        }
        debugApp = null;
    }
    if (debugContainer) {
        debugContainer.remove();
        debugContainer = null;
    }

    // 关闭侧边栏
    if (sidebarApp) {
        try {
            unmount(sidebarApp);
        } catch {
            // ignore cleanup errors
        }
        sidebarApp = null;
    }
    if (sidebarContainer) {
        sidebarContainer.remove();
        sidebarContainer = null;
    }
    sidebarOpen = false;

    // 清理 disposables
    playerDisposables?.dispose();
    playerDisposables = null;

    // 重置状态
    danmakuState.loading = false;
    danmakuState.episodeInfo = null;

    pluginActive = false;
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

        // 获取当前媒体项
        const item = await getCurrentItem(danmakuState.isNewJellyfin, danmakuState.itemId);
        if (!item) {
            logger.warn('loadDanmaku', 'No current item');
            return;
        }

        // 匹配剧集
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

        // 获取弹幕
        const fetcher = new CommentFetcher({
            apiPrefix: danmakuState.effectiveApiPrefix,
            chConvert: danmakuState.chConvert,
            sourceFilter: danmakuState.sourceFilter,
            useXmlDanmaku: danmakuState.useXmlDanmaku,
        });

        const comments = await fetcher.fetch(episodeInfo.episodeId, item.Id);

        // 初始化弹幕引擎
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
function setupMenuInjection(): () => void {
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (!(node instanceof HTMLElement)) continue;

                const actionSheet = node.classList.contains('actionSheet') ? node : node.querySelector('.actionSheet');

                if (!actionSheet) continue;
                if (!actionSheet.querySelector('[data-id="aspectratio"]')) continue;
                if (!actionSheet.querySelector('[data-id="playbackrate"]')) continue;

                injectSettingsMenuItem(actionSheet);
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // 检查当前是否已经有菜单
    const existingActionSheet = document.querySelector('.actionSheet');
    if (existingActionSheet) {
        injectSettingsMenuItem(existingActionSheet);
    }

    return () => observer.disconnect();
}

/**
 * 注入设置菜单项
 */
function injectSettingsMenuItem(actionSheet: Element) {
    if (actionSheet.querySelector('[data-id="danmaku-settings"]')) return;

    const menuItem = document.createElement('button');
    menuItem.setAttribute('data-id', 'danmaku-settings');
    menuItem.setAttribute('is', 'emby-button');
    menuItem.setAttribute('type', 'button');
    menuItem.className = 'btnDanmakuSettings listItem listItem-button actionSheetMenuItem emby-button';
    menuItem.innerHTML = `
        <span class="actionsheetMenuItemIcon listItemIcon listItemIcon-transparent material-icons">comment</span>
        <div class="listItemBody actionsheetListItemBody">
            <div class="listItemBodyText actionSheetItemText">弹幕设置</div>
        </div>
    `;

    menuItem.addEventListener('click', () => {
        const closeBtn = actionSheet.closest('.dialogContainer')?.querySelector('.btnCloseActionSheet');
        (closeBtn as HTMLElement)?.click();
        openSidebar();
    });

    // 尝试插入到循环模式之前
    const repeatModeItem = actionSheet.querySelector('[data-id="repeatmode"]');
    const statsItem = actionSheet.querySelector('[data-id="stats"]');

    if (repeatModeItem) {
        actionSheet.insertBefore(menuItem, repeatModeItem);
    } else if (statsItem) {
        actionSheet.insertBefore(menuItem, statsItem);
    } else {
        actionSheet.appendChild(menuItem);
    }
}

/**
 * 打开设置侧边栏
 */
function openSidebar() {
    if (sidebarOpen || !pluginActive) return;

    sidebarContainer = document.createElement('div');
    document.body.appendChild(sidebarContainer);

    sidebarApp = mount(Sidebar, {
        target: sidebarContainer,
        props: {
            open: true,
            onSave: () => {
                danmakuState.persist();
                sidebarOpen = false;
                sidebarApp = null;
                sidebarContainer?.remove();
                sidebarContainer = null;
                eventBus.emit('danmaku:reload', { reason: 'settings-changed' });
            },
            onCancel: () => {
                danmakuState.hydrate();
                sidebarOpen = false;
                sidebarApp = null;
                sidebarContainer?.remove();
                sidebarContainer = null;
            },
        },
    });

    sidebarOpen = true;
}
