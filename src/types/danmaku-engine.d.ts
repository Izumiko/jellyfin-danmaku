declare module 'danmaku' {
    interface DanmakuOptions {
        container: HTMLElement;
        media: HTMLMediaElement;
        comments?: CommentData[];
        engine?: 'canvas' | 'dom';
        speed?: number;
    }

    interface CommentData {
        text: string;
        mode: 'rtl' | 'ltr' | 'top' | 'bottom';
        time: number;
        style?: {
            font?: string;
            fillStyle?: string;
            strokeStyle?: string;
            lineWidth?: number;
        };
    }

    class Danmaku {
        constructor(options: DanmakuOptions);
        show(): void;
        hide(): void;
        clear(): void;
        destroy(): void;
        resize(): void;
        emit(comment: CommentData): void;
        readonly comments: CommentData[];
    }

    export default Danmaku;
}
