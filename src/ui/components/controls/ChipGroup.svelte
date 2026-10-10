<script lang="ts" generics="K extends string">
    /** 多选筛选标签（MUI Chip 风格）：选中 = 显示该类弹幕 */
    let {
        label,
        description = '',
        items,
        values,
        onchange,
    }: {
        label: string;
        description?: string;
        items: { key: K; label: string }[];
        values: Record<K, boolean>;
        onchange: (values: Record<K, boolean>) => void;
    } = $props();

    function toggle(key: K) {
        onchange({ ...values, [key]: !values[key] });
    }
</script>

<div class="chip-group">
    <span class="label">{label}</span>
    {#if description}<span class="description">{description}</span>{/if}
    <div class="chips">
        {#each items as item (item.key)}
            <button type="button" aria-pressed={values[item.key]} class:on={values[item.key]} onclick={() => toggle(item.key)}>
                <span class="check" aria-hidden="true">{values[item.key] ? '✓' : ''}</span>
                {item.label}
            </button>
        {/each}
    </div>
</div>

<style>
    .chip-group {
        padding: 6px 0 10px;
    }

    .label {
        display: block;
        font-size: 0.95rem;
    }

    .description {
        display: block;
        font-size: 0.8rem;
        color: var(--danmaku-text-secondary);
    }

    .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 8px;
    }

    button {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        height: 32px;
        padding: 0 12px;
        border: 1px solid var(--danmaku-border);
        border-radius: 16px;
        background: transparent;
        color: var(--danmaku-text-secondary);
        font: inherit;
        font-size: 0.85rem;
        cursor: pointer;
        transition: background-color 150ms, color 150ms, border-color 150ms;
    }

    button:hover {
        background: var(--danmaku-hover);
    }

    button.on {
        border-color: transparent;
        background: rgb(var(--danmaku-primary-channel) / 0.2);
        color: var(--danmaku-text);
    }

    .check {
        display: inline-block;
        width: 0;
        overflow: hidden;
        color: var(--danmaku-primary);
        transition: width 150ms;
    }

    button.on .check {
        width: 1em;
    }

    button:focus-visible {
        outline: 2px solid var(--danmaku-primary);
        outline-offset: 1px;
    }
</style>
