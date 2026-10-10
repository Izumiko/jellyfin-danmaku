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
    init(config: EngineConfig, rawComments: RawComment[]): number {
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
            containerHeight: config.container.clientHeight * config.heightRatio,
        });

        // 2. 防重叠过滤（如果启用）
        let finalComments = processed;
        if (danmakuState.useAntiOverlap) {
            finalComments = antiOverlapFilter(processed, {
                containerWidth: config.container.clientWidth,
                containerHeight: config.container.clientHeight * config.heightRatio,
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
        this.backfillInFlight(config.media);

        // 5. ResizeObserver（debounced 100ms）
        this.setupResizeObserver(config.container);

        // 6. MutationObserver（仅 src 属性）
        this.setupMediaObserver(config.media);

        logger.info('engine', `Danmaku engine initialized with ${finalComments.length} comments`);
        return finalComments.length;
    }

    /** 透明度只影响容器样式，无需重建 */
    setOpacity(opacity: number): void {
        if (this.wrapper) this.wrapper.style.opacity = String(opacity);
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
            height: `max(0px, calc(${config.heightRatio * 100}% - 18px))`,
            opacity: String(config.opacity),
            pointerEvents: 'none',
        });

        return wrapper;
    }

    /**
     * 播放中重建引擎时，danmaku 库会 seek 到当前时间，跳过最近一个滚动周期内"飞行中"的弹幕，
     * 导致调整设置时画面先清空 1~2 秒。把读取位置回退一个周期，库会按已经过的时间把它们画在半路上。
     * 依赖 danmaku@2 的内部字段 `_`，字段缺失时静默跳过。
     */
    private backfillInFlight(media: HTMLMediaElement): void {
        const instance = this.instance as unknown as {
            comments?: { time: number }[];
            _?: { position?: number; duration?: number; paused?: boolean };
        } | null;
        const internal = instance?._;
        const comments = instance?.comments;
        if (!internal || !comments || internal.paused || typeof internal.position !== 'number' || typeof internal.duration !== 'number') return;

        const since = media.currentTime - internal.duration;
        let low = 0;
        let high = comments.length;
        while (low < high) {
            const mid = (low + high) >> 1;
            if (comments[mid].time < since) low = mid + 1;
            else high = mid;
        }
        internal.position = Math.min(internal.position, low);
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
