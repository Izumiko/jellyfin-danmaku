<script lang="ts" generics="T extends string | number">
    /** 单选分段按钮（MUI ToggleButtonGroup 风格），用于少量互斥选项 */
    let {
        label,
        value,
        options,
        onchange,
    }: {
        label: string;
        value: T;
        options: { value: T; label: string }[];
        onchange: (value: T) => void;
    } = $props();
</script>

<div class="segmented-field" role="radiogroup" aria-label={label}>
    <span class="label">{label}</span>
    <div class="group">
        {#each options as option (option.value)}
            <button
                type="button"
                role="radio"
                aria-checked={option.value === value}
                class:selected={option.value === value}
                onclick={() => onchange(option.value)}
            >
                {option.label}
            </button>
        {/each}
    </div>
</div>

<style>
    .segmented-field {
        padding: 6px 0;
    }

    .label {
        display: block;
        margin-bottom: 6px;
        font-size: 0.95rem;
    }

    .group {
        display: flex;
        border: 1px solid var(--danmaku-border);
        border-radius: 4px;
        overflow: hidden;
    }

    button {
        flex: 1;
        padding: 7px 4px;
        border: none;
        border-left: 1px solid var(--danmaku-border);
        background: transparent;
        color: var(--danmaku-text-secondary);
        font: inherit;
        font-size: 0.85rem;
        cursor: pointer;
        transition: background-color 150ms, color 150ms;
    }

    button:first-child {
        border-left: none;
    }

    button:hover {
        background: var(--danmaku-hover);
    }

    button.selected {
        background: rgb(var(--danmaku-primary-channel) / 0.2);
        color: var(--danmaku-primary);
    }

    button:focus-visible {
        outline: 2px solid var(--danmaku-primary);
        outline-offset: -2px;
    }
</style>
