import { mount, unmount } from 'svelte';
import { detectJellyfinVersion, waitForApiClient } from './services/jellyfin/client';
import { interceptPlaybackInfo } from './services/jellyfin/interceptor';
import { danmakuState } from './core/state.svelte';
import { eventBus } from './core/event-bus';
import { logger } from './core/logger';
import { DisposableStore } from './utils/disposable';
import { insertBeforeRef, waitForElement } from './utils/dom';
import { SELECTORS } from './core/config';
import { DanmakuRuntime } from './runtime';
import DanmakuToggle from './ui/components/DanmakuToggle.svelte';
import SendDanmaku from './ui/components/SendDanmaku.svelte';
import Sidebar from './ui/components/Sidebar.svelte';
import DebugOverlay from './ui/components/DebugOverlay.svelte';

/**
 * 全局插件状态
 */
let pluginActive = false;
let runtime: DanmakuRuntime | null = null;
let menuInjectionCleanup: (() => void) | null = null;
let sidebarOpen = false;
let sidebarApp: ReturnType<typeof mount> | null = null;
let sidebarContainer: HTMLDivElement | null = null;
let controlsContainer: HTMLDivElement | null = null;
let toggleApp: ReturnType<typeof mount> | null = null;
let toggleContainer: HTMLDivElement | null = null;
let sendApp: ReturnType<typeof mount> | null = null;
let sendContainer: HTMLDivElement | null = null;
let debugApp: ReturnType<typeof mount> | null = null;
let debugContainer: HTMLDivElement | null = null;
let playerInitGeneration = 0;

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
        logger.setEnabled(danmakuState.logSwitch);

        // 3. 安装 XHR 拦截器
        const cleanupInterceptor = interceptPlaybackInfo((id) => {
            const previous = danmakuState.itemId;
            danmakuState.itemId = id;
            logger.debug('bootstrap', `Item ID captured: ${id}`);
            if (pluginActive && previous !== id) {
                eventBus.emit('danmaku:reload', { reason: previous ? 'refresh' : 'init' });
            }
        });
        disposables.add(cleanupInterceptor);

        // 4. 监听播放器生命周期
        const cleanupLifecycle = observePlayerLifecycle();
        disposables.add(cleanupLifecycle);

        // 5. 注入 Jellyfin 菜单（全局只需一次）
        menuInjectionCleanup = setupMenuInjection();

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
        let playerRemoved = false;
        let playerAdded = false;

        for (const mutation of mutations) {
            for (const node of mutation.removedNodes) {
                if (!(node instanceof HTMLElement)) continue;
                if (node.classList.contains('videoPlayerContainer') || node.querySelector('.videoPlayerContainer')) {
                    playerRemoved = true;
                }
            }

            for (const node of mutation.addedNodes) {
                if (!(node instanceof HTMLElement)) continue;
                if (node.classList.contains('videoPlayerContainer') || node.querySelector('.videoPlayerContainer')) {
                    playerAdded = true;
                }
            }
        }

        // 同一次 DOM 更新可能同时移除旧播放器并加入新播放器。
        // 先清理旧实例，再初始化新实例，避免因为 return 提前漏掉其中一侧。
        if (playerRemoved) {
            logger.info('lifecycle', 'Video player removed');
            cleanupPlayer();
            eventBus.emit('media:removed', undefined);
        }

        if (playerAdded) {
            logger.info('lifecycle', 'Video player added');
            void initPlayer();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    if (document.querySelector('.videoPlayerContainer')) {
        logger.info('lifecycle', 'Video player already exists');
        void initPlayer();
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

    const generation = ++playerInitGeneration;
    pluginActive = true;

    try {
        // 等待控制栏
        const osdPage = await waitForElement(SELECTORS.mediaContainer, { timeout: 10000 });
        if (generation !== playerInitGeneration || !document.querySelector('.videoPlayerContainer')) {
            return;
        }

        logger.info('lifecycle', 'Control bar detected');
        const pauseButton = osdPage.querySelector(SELECTORS.pauseButton);
        const controlBar = pauseButton?.parentElement;
        if (!controlBar) {
            throw new Error('Player control bar not found');
        }

        // 与 ede.js 一致：弹幕控制使用独立容器，作为暂停控制组的兄弟节点，
        // 避免把自定义按钮塞入 Jellyfin 内部按钮组导致主题/版本兼容问题。
        controlsContainer = document.createElement('div');
        controlsContainer.id = 'danmakuCtr';
        controlsContainer.style.display = 'flex';
        controlsContainer.style.alignItems = 'center';
        controlBar.parentNode?.insertBefore(controlsContainer, controlBar.nextSibling);

        if (!controlsContainer.parentNode) {
            throw new Error('Unable to mount danmaku controls');
        }

        toggleContainer = document.createElement('div');
        toggleContainer.style.display = 'contents';
        controlsContainer.appendChild(toggleContainer);

        toggleApp = mount(DanmakuToggle, {
            target: toggleContainer,
        });

        sendContainer = document.createElement('div');
        sendContainer.style.display = 'contents';
        controlsContainer.appendChild(sendContainer);

        sendApp = mount(SendDanmaku, {
            target: sendContainer,
        });

        debugContainer = document.createElement('div');
        debugContainer.style.position = 'fixed';
        debugContainer.style.zIndex = '2';
        debugContainer.style.right = '16px';
        debugContainer.style.top = '72px';
        debugContainer.style.pointerEvents = 'none';
        document.body.appendChild(debugContainer);

        debugApp = mount(DebugOverlay, {
            target: debugContainer,
        });

        runtime = new DanmakuRuntime();
        await runtime.start();

        logger.info('lifecycle', 'Player initialization completed');
    } catch (error) {
        if (generation !== playerInitGeneration) return;
        logger.error('lifecycle', 'Failed to initialize player', error);
        cleanupPlayer();
    }
}

/**
 * 清理播放器相关资源
 */
function cleanupPlayer() {
    // 使仍在 await waitForElement() 的旧初始化失效。
    playerInitGeneration++;
    if (!pluginActive) return;

    logger.info('lifecycle', 'Cleaning up player resources');

    runtime?.destroy();
    runtime = null;

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

    if (sendApp) {
        try {
            unmount(sendApp);
        } catch {
            // ignore cleanup errors
        }
        sendApp = null;
    }
    if (sendContainer) {
        sendContainer.remove();
        sendContainer = null;
    }
    if (controlsContainer) {
        controlsContainer.remove();
        controlsContainer = null;
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

    closeSidebar();

    // 重置状态
    danmakuState.loading = false;
    danmakuState.episodeInfo = null;

    pluginActive = false;
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
        <div class="listItemBody actionsheetListItemBody">
            <div class="listItemBodyText actionSheetItemText">弹幕设置</div>
        </div>
    `;

    menuItem.addEventListener('click', () => {
        const closeBtn = actionSheet.closest('.dialogContainer')?.querySelector('.btnCloseActionSheet');
        (closeBtn as HTMLElement)?.click();
        openSidebar();
    });

    const repeatModeItem = actionSheet.querySelector('[data-id="repeatmode"]');
    const statsItem = actionSheet.querySelector('[data-id="stats"]');
    insertBeforeRef(actionSheet, menuItem, repeatModeItem ?? statsItem);
}

function closeSidebar() {
    if (sidebarApp) {
        try {
            unmount(sidebarApp);
        } catch {
            /* ignore */
        }
        sidebarApp = null;
    }
    sidebarContainer?.remove();
    sidebarContainer = null;
    sidebarOpen = false;
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
                closeSidebar();
                eventBus.emit('danmaku:reload', { reason: 'settings-changed' });
            },
            onCancel: () => {
                danmakuState.hydrate();
                eventBus.emit('danmaku:visibility', { visible: danmakuState.danmakuSwitch });
                logger.setEnabled(danmakuState.logSwitch);
                closeSidebar();
            },
        },
    });

    sidebarOpen = true;
}
