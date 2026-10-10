<script lang="ts">
    let {
        label,
        description = '',
        checked,
        onchange,
    }: {
        label: string;
        description?: string;
        checked: boolean;
        onchange: (checked: boolean) => void;
    } = $props();
</script>

<label class="switch-row">
    <span class="text">
        <span class="label">{label}</span>
        {#if description}<span class="description">{description}</span>{/if}
    </span>
    <span class="switch">
        <input type="checkbox" role="switch" {checked} onchange={(e) => onchange(e.currentTarget.checked)} />
        <span class="track" aria-hidden="true"></span>
        <span class="thumb" aria-hidden="true"></span>
    </span>
</label>

<style>
    .switch-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 8px 0;
        cursor: pointer;
    }

    .text {
        display: flex;
        flex-direction: column;
        min-width: 0;
    }

    .label {
        font-size: 0.95rem;
    }

    .description {
        font-size: 0.8rem;
        color: var(--danmaku-text-secondary);
    }

    /* MUI Switch 尺寸：轨道 34×14，滑块 20 */
    .switch {
        position: relative;
        flex: none;
        width: 38px;
        height: 24px;
    }

    input {
        position: absolute;
        inset: 0;
        z-index: 1;
        width: 100%;
        height: 100%;
        margin: 0;
        opacity: 0;
        cursor: pointer;
    }

    .track {
        position: absolute;
        top: 5px;
        left: 2px;
        width: 34px;
        height: 14px;
        border-radius: 7px;
        background: var(--danmaku-text);
        opacity: 0.38;
        transition: background-color 150ms, opacity 150ms;
    }

    .thumb {
        position: absolute;
        top: 2px;
        left: 0;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: #e0e0e0;
        box-shadow: 0 2px 1px -1px rgba(0, 0, 0, 0.2), 0 1px 1px rgba(0, 0, 0, 0.14), 0 1px 3px rgba(0, 0, 0, 0.12);
        transition: transform 150ms;
    }

    input:checked ~ .track {
        background: var(--danmaku-primary);
        opacity: 0.5;
    }

    input:checked ~ .thumb {
        transform: translateX(18px);
        background: var(--danmaku-primary);
    }

    input:focus-visible ~ .thumb {
        outline: 2px solid var(--danmaku-primary);
        outline-offset: 2px;
    }
</style>
