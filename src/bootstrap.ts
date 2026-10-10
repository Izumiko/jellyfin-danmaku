import { mount, unmount, type Component } from 'svelte';
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
import Snackbar from './ui/components/Snackbar.svelte';

type MountedApp = { app: ReturnType<typeof mount>; target: HTMLElement };

/**
 * 全局插件状态
 */
let pluginActive = false;
let runtime: DanmakuRuntime | null = null;
let menuInjectionCleanup: (() => void) | null = null;
let sidebar: MountedApp | null = null;
let controlsContainer: HTMLDivElement | null = null;
/** 随播放器创建/销毁的 Svelte 组件 */
let playerApps: MountedApp[] = [];
let playerInitGeneration = 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 与 svelte mount() 的泛型约束保持一致
function mountApp<Props extends Record<string, any>>(component: Component<Props>, parent: HTMLElement, props: Props, style: Partial<CSSStyleDeclaration> = {}): MountedApp {
    const target = document.createElement('div');
    Object.assign(target.style, style);
    parent.appendChild(target);
    return { app: mount(component, { target, props }), target };
}

function unmountApp({ app, target }: MountedApp): void {
    try {
        unmount(app);
    } catch {
        // ignore cleanup errors
    }
    target.remove();
}

/**
 * 主入口 - 监听播放器生命周期
 */
export async function bootstrap() {
    const disposables = new DisposableStore();

    try {
        logger.setEnabled(danmakuState.logSwitch);

        // 1. 尽早安装 XHR 拦截器，避免等待 ApiClient 期间错过首个 PlaybackInfo 请求
        const cleanupInterceptor = interceptPlaybackInfo((id) => {
            const previous = danmakuState.itemId;
            danmakuState.itemId = id;
            logger.debug('bootstrap', `Item ID captured: ${id}`);
            if (pluginActive && previous !== id) {
                eventBus.emit('danmaku:reload', { reason: previous ? 'refresh' : 'init' });
            }
        });
        disposables.add(cleanupInterceptor);

        // 2. 等待 ApiClient 就绪。登录页或慢网络下可能较久，不设超时（ede.js 同样无限等待播放器）
        await waitForApiClient(Number.POSITIVE_INFINITY);

        // 3. 检测 Jellyfin 版本
        const { isNewJellyfin } = detectJellyfinVersion();
        danmakuState.isNewJellyfin = isNewJellyfin;

        // 4. 监听播放器生命周期
        const cleanupLifecycle = observePlayerLifecycle();
        disposables.add(cleanupLifecycle);

        // 5. 注入 Jellyfin 菜单（全局只需一次）
        menuInjectionCleanup = setupMenuInjection();
        disposables.add(eventBus.on('settings:open', () => openSidebar()));

        logger.info('bootstrap', 'Bootstrap completed, watching for video player');
    } catch (error) {
        disposables.dispose();
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
        // 等待控制栏：OSD 页面可能先于其中的按钮渲染，直接等待暂停按钮
        const pauseButton = await waitForElement(`${SELECTORS.mediaContainer} ${SELECTORS.pauseButton}`, { timeout: 15000 });
        if (generation !== playerInitGeneration || !document.querySelector('.videoPlayerContainer')) {
            return;
        }

        logger.info('lifecycle', 'Control bar detected');
        const controlBar = pauseButton.parentElement;
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

        // display: contents 让按钮直接参与 Jellyfin 控制栏的 flex 布局
        playerApps.push(
            mountApp(DanmakuToggle, controlsContainer, {}, { display: 'contents' }),
            mountApp(SendDanmaku, controlsContainer, {}, { display: 'contents' }),
            mountApp(DebugOverlay, document.body, {}, { position: 'fixed', zIndex: '2', right: '16px', top: '72px', pointerEvents: 'none' }),
            mountApp(Snackbar, document.body, {}),
        );

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
    playerApps.forEach(unmountApp);
    playerApps = [];
    controlsContainer?.remove();
    controlsContainer = null;

    closeSidebar();

    // 重置状态
    danmakuState.loading = false;
    danmakuState.episodeInfo = null;
    danmakuState.loadedSource = null;
    danmakuState.loadedCount = 0;
    danmakuState.visibleCount = 0;

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

                if (actionSheet && isPlayerSettingsSheet(actionSheet)) {
                    injectSettingsMenuItem(actionSheet);
                }
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // 检查当前是否已经有菜单
    document.querySelectorAll('.actionSheet').forEach((actionSheet) => {
        if (isPlayerSettingsSheet(actionSheet)) injectSettingsMenuItem(actionSheet);
    });

    return () => observer.disconnect();
}

/** 仅播放器设置菜单（含画面比例与播放速度项）才注入弹幕设置 */
function isPlayerSettingsSheet(actionSheet: Element): boolean {
    return !!actionSheet.querySelector('[data-id="aspectratio"]') && !!actionSheet.querySelector('[data-id="playbackrate"]');
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
    if (!sidebar) return;
    unmountApp(sidebar);
    sidebar = null;
}

/**
 * 打开设置侧边栏。设置即时生效并自动保存，无需保存/取消。
 */
function openSidebar() {
    if (sidebar || !pluginActive) return;
    sidebar = mountApp(Sidebar, document.body, { onClose: closeSidebar });
}
