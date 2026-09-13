<script lang="ts">
    import '../styles/variables.css';

    let {
        title,
        options,
        defaultIndex = 0,
        onConfirm,
        onCancel,
    } = $props<{
        title: string;
        options: string[];
        defaultIndex: number;
        onConfirm: (index: number) => void;
        onCancel: () => void;
    }>();

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') {
            onCancel();
        }
    }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="dialog-backdrop">
    <div class="dialog-panel">
        <h3>{title}</h3>
        <div class="option-list">
            {#each options as option, index (index)}
                <button
                    type="button"
                    class="option"
                    class:active={index === defaultIndex}
                    data-action="option"
                    onclick={() => onConfirm(index)}
                >
                    {option}
                </button>
            {/each}
        </div>
        <div class="dialog-actions">
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

    .option-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 50vh;
        overflow-y: auto;
    }

    .option {
        width: 100%;
        text-align: left;
        padding: 10px 12px;
        background: transparent;
        color: var(--danmaku-text, #e0e0e0);
        border: 1px solid var(--danmaku-border, rgba(255, 255, 255, 0.1));
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
    }

    .option:hover {
        background: var(--danmaku-hover, rgba(255, 255, 255, 0.05));
    }

    .option.active {
        border-color: var(--danmaku-primary, #00a4dc);
        background: rgba(0, 164, 220, 0.15);
    }

    .dialog-actions {
        display: flex;
        justify-content: flex-end;
        margin-top: 16px;
    }

    [data-action='cancel'] {
        padding: 8px 16px;
        background: transparent;
        color: var(--danmaku-text, #e0e0e0);
        border: 1px solid var(--danmaku-border, rgba(255, 255, 255, 0.1));
        border-radius: 4px;
        font-size: 14px;
        cursor: pointer;
    }
</style>
