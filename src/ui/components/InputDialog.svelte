<script lang="ts">
    import '../styles/variables.css';

    let {
        title,
        placeholder,
        defaultValue = '',
        onConfirm,
        onCancel,
    } = $props<{
        title: string;
        placeholder: string;
        defaultValue: string;
        onConfirm: (value: string) => void;
        onCancel: () => void;
    }>();

    let inputEl: HTMLInputElement | undefined;

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') {
            onCancel();
        }
    }

    function handleInputKeydown(e: KeyboardEvent) {
        e.stopPropagation();
    }

    function handleConfirm() {
        onConfirm(inputEl?.value ?? defaultValue);
    }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="dialog-backdrop" data-dialog="input">
    <div class="dialog-panel">
        <h3>{title}</h3>
        <input
            bind:this={inputEl}
            type="text"
            {placeholder}
            value={defaultValue}
            onkeydown={handleInputKeydown}
        />
        <div class="dialog-actions">
            <button type="button" data-action="confirm" onclick={handleConfirm}>确定</button>
            <button type="button" data-action="cancel" onclick={onCancel}>取消</button>
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
        width: min(420px, 90vw);
        padding: 20px;
        background: var(--danmaku-bg, rgba(30, 30, 30, 0.95));
        color: var(--danmaku-text, #e0e0e0);
        border: 1px solid var(--danmaku-border, rgba(255, 255, 255, 0.1));
        border-radius: var(--danmaku-radius, 8px);
        box-shadow: var(--danmaku-shadow, 0 4px 12px rgba(0, 0, 0, 0.3));
    }

    h3 {
        margin: 0 0 16px 0;
        font-size: 16px;
        font-weight: 500;
    }

    input {
        width: 100%;
        box-sizing: border-box;
        padding: 8px 12px;
        background: rgba(0, 0, 0, 0.3);
        color: var(--danmaku-text, #e0e0e0);
        border: 1px solid var(--danmaku-border, rgba(255, 255, 255, 0.1));
        border-radius: 4px;
        font-size: 14px;
    }

    .dialog-actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 16px;
    }

    .dialog-actions button {
        padding: 8px 16px;
        border-radius: 4px;
        font-size: 14px;
        cursor: pointer;
    }

    [data-action='confirm'] {
        background: var(--danmaku-primary, #00a4dc);
        color: white;
        border: none;
    }

    [data-action='cancel'] {
        background: transparent;
        color: var(--danmaku-text, #e0e0e0);
        border: 1px solid var(--danmaku-border, rgba(255, 255, 255, 0.1));
    }
</style>
