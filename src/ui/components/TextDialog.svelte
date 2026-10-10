<script lang="ts">
    import '../styles/variables.css';

    /** 多行文本对话框：readonly 用于导出（带复制），否则用于粘贴导入 */
    let {
        title,
        defaultValue = '',
        readonly = false,
        onConfirm,
        onCancel,
    }: {
        title: string;
        defaultValue?: string;
        readonly?: boolean;
        onConfirm: (value: string) => void;
        onCancel: () => void;
    } = $props();

    // svelte-ignore state_referenced_locally
    let value = $state(defaultValue);
    let copied = $state(false);
    let textareaEl = $state<HTMLTextAreaElement | undefined>();

    $effect(() => {
        textareaEl?.focus();
        if (readonly) textareaEl?.select();
    });

    async function copy() {
        try {
            await navigator.clipboard.writeText(value);
        } catch {
            // 非安全上下文（http）没有 clipboard API，退回到选中 + execCommand
            textareaEl?.select();
            document.execCommand('copy');
        }
        copied = true;
    }

    function handleKeydown(e: KeyboardEvent) {
        e.stopPropagation();
        if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
        }
    }

    function stopPlayerGestures(e: Event) {
        e.stopPropagation();
    }
</script>

<div class="dialog-backdrop" role="dialog" aria-modal="true" aria-label={title} tabindex="-1" onkeydown={handleKeydown}>
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="dialog-panel" role="document" onpointerdown={stopPlayerGestures} onmousedown={stopPlayerGestures} ontouchstart={stopPlayerGestures} onwheel={stopPlayerGestures}>
        <h3>{title}</h3>
        <textarea bind:this={textareaEl} bind:value {readonly} spellcheck="false" rows="12"></textarea>
        <div class="dialog-actions">
            {#if readonly}
                <button type="button" class="text" onclick={copy}>{copied ? '已复制' : '复制'}</button>
                <button type="button" class="primary" onclick={onCancel}>关闭</button>
            {:else}
                <button type="button" class="text" onclick={onCancel}>取消</button>
                <button type="button" class="primary" disabled={!value.trim()} onclick={() => onConfirm(value)}>导入</button>
            {/if}
        </div>
    </div>
</div>

<style>
    .dialog-backdrop {
        position: fixed;
        inset: 0;
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.5);
    }

    .dialog-panel {
        display: flex;
        flex-direction: column;
        gap: 12px;
        width: min(560px, calc(100vw - 32px));
        box-sizing: border-box;
        padding: 20px;
        border-radius: var(--danmaku-radius, 4px);
        background: var(--danmaku-bg, #202020);
        color: var(--danmaku-text, #fff);
        font-family: var(--danmaku-font);
        box-shadow: var(--danmaku-shadow);
    }

    h3 {
        margin: 0;
        font-size: 1.1rem;
        font-weight: 500;
    }

    textarea {
        width: 100%;
        box-sizing: border-box;
        padding: 10px 12px;
        border: none;
        border-bottom: 1px solid var(--danmaku-text-secondary);
        border-radius: 4px 4px 0 0;
        outline: none;
        resize: vertical;
        background: var(--danmaku-input-bg, rgba(255, 255, 255, 0.09));
        color: inherit;
        font-family: ui-monospace, Consolas, monospace;
        font-size: 0.8rem;
        line-height: 1.5;
    }

    textarea:focus {
        border-bottom: 2px solid var(--danmaku-primary);
    }

    .dialog-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
    }

    button {
        min-height: 36px;
        padding: 6px 16px;
        border: none;
        border-radius: var(--danmaku-radius, 4px);
        font: inherit;
        font-size: 0.9rem;
        font-weight: 500;
        cursor: pointer;
    }

    button:disabled {
        opacity: 0.5;
        cursor: default;
    }

    .text {
        background: transparent;
        color: var(--danmaku-primary);
    }

    .text:hover {
        background: rgb(var(--danmaku-primary-channel) / 0.08);
    }

    .primary {
        background: var(--danmaku-primary);
        color: var(--danmaku-on-primary, #fff);
    }
</style>
