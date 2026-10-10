import Danmaku from 'danmaku';
import { debounce } from '../utils/dom';
import { eventBus } from '../core/event-bus';
import { logger } from '../core/logger';
import { danmakuState } from '../core/state.svelte';
import { preProcessWithReport } from './processor';
import { parseBlockRules } from './shield';
import { antiOverlapFilter } from './anti-overlap';
import { textMeasurer } from './text-measure';
import type { EngineConfig, ProcessedComment, RawComment } from '../types/index';

/** danmaku@2 的内部状态（非公开 API），只读写下面用到的字段 */
type DanmakuInternals = {
    position: number;
    duration: number;
    width: number;
    paused: boolean;
    engine: { render: (stage: unknown, comment: InternalComment) => void };
    listener?: { play?: () => void; pause?: () => void };
};
type InternalComment = { mode: string; time: number; width: number; x: number };

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
    private media: HTMLMediaElement | null = null;
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
        const { comments: processed, blocked } = preProcessWithReport(rawComments, {
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
            blockRules: parseBlockRules(danmakuState),
            stripLikeSuffix: danmakuState.stripLikeSuffix,
            mergeSimilar: danmakuState.mergeSimilar,
            mergeThreshold: danmakuState.mergeThreshold,
        });
        danmakuState.blockedCount = blocked;

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

        this.media = config.media;
        if (config.visible) {
            this.instance.show();
        } else {
            this.instance.hide();
        }
        this.patchTiming();
        this.rewindToInFlight();
        this.setupSeekPatch(config.media);

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

    /** hide() 会清屏并停止帧循环；show() 后补回正在飞行中的弹幕 */
    show(): void {
        this.instance?.show();
        this.rewindToInFlight();
    }

    hide(): void {
        this.instance?.hide();
    }

    /** 弹幕容器是否仍挂在页面上（React 重渲染可能把它摘掉） */
    isMounted(): boolean {
        return !!this.wrapper?.isConnected;
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
        this.media = null;

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

    private internals(): (DanmakuInternals & { comments: { time: number }[] }) | null {
        const instance = this.instance as unknown as { comments?: { time: number }[]; _?: Partial<DanmakuInternals> } | null;
        const internal = instance?._;
        if (!internal || !instance?.comments || typeof internal.position !== 'number' || typeof internal.duration !== 'number') return null;
        return Object.assign(internal as DanmakuInternals, { comments: instance.comments });
    }

    /**
     * danmaku 库在构造、show() 和 seeking 时都会把读取位置定到当前时间，跳过最近一个滚动周期内
     * "飞行中"的弹幕：调整设置、打开开关、拖动进度条后画面都会先空 1~2 秒。
     * 把读取位置回退到 currentTime - duration，库会按已经过的时间把它们画在半路上。
     * 依赖 danmaku@2 的内部字段，缺失时静默跳过（移植自 ede.js v1.62 的引擎补丁）。
     */
    private rewindToInFlight(): void {
        const internal = this.internals();
        if (!internal || !this.media) return;

        const since = this.media.currentTime - internal.duration;
        const comments = internal.comments;
        let low = 0;
        let high = comments.length;
        while (low < high) {
            const mid = (low + high) >> 1;
            if (comments[mid].time < since) low = mid + 1;
            else high = mid;
        }
        internal.position = Math.min(internal.position, low);
    }

    /** 库自己的 seeking 监听先注册、先执行（seek 到当前时间），这里随后回退读取位置 */
    private setupSeekPatch(media: HTMLMediaElement): void {
        const onSeeking = () => this.rewindToInFlight();
        media.addEventListener('seeking', onSeeking);
        this.disposables.push(() => media.removeEventListener('seeking', onSeeking));
    }

    /**
     * 倍速不漂移：库用墙钟时间（_utc）× playbackRate 推算滚动位置，切换倍速或卡顿后会与画面错位。
     * 改为直接按 media.currentTime 计算（currentTime 已包含倍速）。
     * 帧循环在 play() 时捕获 render，所以替换后要重启本实例的循环（不发事件、不清屏）。
     */
    private patchTiming(): void {
        const internal = this.internals();
        const media = this.media;
        const listener = internal?.listener;
        if (!internal || !media || typeof internal.engine?.render !== 'function' || typeof listener?.play !== 'function' || typeof listener?.pause !== 'function') return;

        const render = internal.engine.render;
        const instance = this.instance;
        const running = !internal.paused;
        if (running) listener.pause();
        // engine 是库内共享的模块对象，复制一份再改，避免影响其他实例
        internal.engine = Object.assign({}, internal.engine, {
            render: (stage: unknown, comment: InternalComment) => {
                if (comment.mode === 'rtl' || comment.mode === 'ltr') {
                    const distance = ((internal.width + comment.width) * (media.currentTime - comment.time)) / internal.duration;
                    comment.x = comment.mode === 'rtl' ? internal.width - distance : distance - comment.width;
                }
                render.call(instance, stage, comment);
            },
        });
        if (running) listener.play();
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
