import Danmaku from 'danmaku';
import { debounce } from '../utils/dom';
import { eventBus } from '../core/event-bus';
import { logger } from '../core/logger';
import { danmakuState } from '../core/state.svelte';
import { preProcessDanmaku } from './processor';
import { antiOverlapFilter } from './anti-overlap';
import { textMeasurer } from './text-measure';
import type { EngineConfig, ProcessedComment, RawComment } from '../types/index';

/**
 * 弹幕渲染引擎
 *
 * 封装 danmaku npm 包，管理：
 * - Canvas 渲染实例
 * - 弹幕容器 DOM 元素（#danmakuWrapper）
 * - ResizeObserver（debounced）
 * - MutationObserver（仅监听 src 属性）
 */
export class DanmakuEngine {
    private instance: Danmaku | null = null;
    private wrapper: HTMLDivElement | null = null;
    private disposables: (() => void)[] = [];

    /**
     * 初始化引擎
     * 如果已有实例，先销毁旧实例
     */
    init(config: EngineConfig, rawComments: RawComment[]): void {
        this.destroy();

        logger.debug('engine', 'Initializing danmaku engine', {
            commentCount: rawComments.length,
            speed: config.speed,
        });

        // 1. 预处理弹幕 - 使用 danmakuState 中的用户配置
        const processed = preProcessDanmaku(rawComments, {
            sourceFilter: danmakuState.sourceFilter,
            modeFilter: danmakuState.modeFilter,
            densityLimit: danmakuState.densityLimit,
            fontSize: danmakuState.fontSize,
            fontFamily: danmakuState.fontFamily,
            fontOptions: danmakuState.fontOptions,
            speed: config.speed,
            timeOffset: danmakuState.curEpOffset || 0,
            containerWidth: config.container.clientWidth,
            containerHeight: config.container.clientHeight,
        });

        // 2. 防重叠过滤（如果启用）
        let finalComments = processed;
        if (danmakuState.useAntiOverlap) {
            finalComments = antiOverlapFilter(processed, {
                containerWidth: config.container.clientWidth,
                containerHeight: config.container.clientHeight,
                fontSize: danmakuState.fontSize,
                speed: config.speed,
                fontFamily: danmakuState.fontFamily,
                fontOptions: danmakuState.fontOptions,
            });
        }

        // 3. 创建容器
        this.wrapper = this.createWrapper(config);
        this.mountWrapper(config.container);

        // 4. 创建 Danmaku 实例
        this.instance = new Danmaku({
            container: this.wrapper,
            media: config.media,
            comments: finalComments,
            engine: 'canvas',
            speed: config.speed,
        });

        if (config.visible) {
            this.instance.show();
        } else {
            this.instance.hide();
        }

        // 5. ResizeObserver（debounced 100ms）
        this.setupResizeObserver(config.container);

        // 6. MutationObserver（仅 src 属性）
        this.setupMediaObserver(config.media);

        logger.info('engine', `Danmaku engine initialized with ${finalComments.length} comments`);
    }

    show(): void {
        this.instance?.show();
    }

    hide(): void {
        this.instance?.hide();
    }

    resize(): void {
        this.instance?.resize();
    }

    emit(comment: ProcessedComment): void {
        this.instance?.emit(comment);
    }

    destroy(): void {
        logger.debug('engine', 'Destroying danmaku engine');

        this.disposables.forEach((fn) => {
            try {
                fn();
            } catch (error) {
                logger.error('engine', 'Error during disposal', error);
            }
        });
        this.disposables = [];

        this.instance?.destroy();
        this.instance = null;

        this.wrapper?.remove();
        this.wrapper = null;

        // 清空文字测量缓存
        textMeasurer.clear();
    }

    private createWrapper(config: EngineConfig): HTMLDivElement {
        const wrapper = document.createElement('div');
        wrapper.id = 'danmakuWrapper';

        Object.assign(wrapper.style, {
            position: 'fixed',
            top: '18px',
            width: '100%',
            height: `calc(${config.heightRatio * 100}% - 18px)`,
            opacity: String(config.opacity),
            pointerEvents: 'none',
            zIndex: '1',
        });

        return wrapper;
    }

    private mountWrapper(container: HTMLElement): void {
        const root = document.getElementById('reactRoot') ?? container;
        root.prepend(this.wrapper!);
    }

    private setupResizeObserver(container: HTMLElement): void {
        const resizeOb = new ResizeObserver(
            debounce(() => {
                logger.debug('engine', 'Container resized, resizing danmaku');
                this.instance?.resize();
            }, 100),
        );

        resizeOb.observe(container);
        this.disposables.push(() => resizeOb.disconnect());
    }

    private setupMediaObserver(media: HTMLVideoElement): void {
        const mutationOb = new MutationObserver((mutations) => {
            for (const m of mutations) {
                if (m.attributeName === 'src') {
                    logger.info('engine', 'Media source changed');
                    eventBus.emit('media:source-changed', undefined);
                    break;
                }
            }
        });

        // 关键：attributeFilter 限制为只监听 src
        mutationOb.observe(media, { attributes: true, attributeFilter: ['src'] });
        this.disposables.push(() => mutationOb.disconnect());
    }
}

// 全局单例
export const danmakuEngine = new DanmakuEngine();
