<script lang="ts">
    /**
     * MUI filled TextField 风格输入框。
     * 默认在 change（失焦/回车）时提交，避免每次按键都触发重载；需要逐字更新时传 oninput。
     */
    let {
        label,
        value,
        placeholder = '',
        type = 'text',
        autocomplete,
        helper = '',
        onchange,
        oninput,
    }: {
        label: string;
        value: string;
        placeholder?: string;
        type?: 'text' | 'password' | 'url';
        autocomplete?: HTMLInputElement['autocomplete'];
        helper?: string;
        onchange?: (value: string) => void;
        oninput?: (value: string) => void;
    } = $props();
</script>

<label class="text-field">
    <span class="box">
        <span class="label">{label}</span>
        <input
            {type}
            {value}
            {placeholder}
            {autocomplete}
            spellcheck="false"
            onchange={(e) => onchange?.(e.currentTarget.value)}
            oninput={(e) => oninput?.(e.currentTarget.value)}
            onkeydown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
            }}
        />
    </span>
    {#if helper}<span class="helper">{helper}</span>{/if}
</label>

<style>
    .text-field {
        display: block;
        margin: 8px 0;
    }

    .box {
        position: relative;
        display: block;
        padding: 22px 12px 6px;
        border-radius: 4px 4px 0 0;
        background: var(--danmaku-input-bg);
        transition: background-color 150ms;
    }

    .box::after {
        content: '';
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        border-bottom: 2px solid var(--danmaku-primary);
        transform: scaleX(0);
        transition: transform 200ms;
    }

    .box::before {
        content: '';
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        border-bottom: 1px solid var(--danmaku-text-secondary);
    }

    .box:hover {
        background: var(--danmaku-hover);
    }

    .box:focus-within::after {
        transform: scaleX(1);
    }

    .label {
        position: absolute;
        top: 6px;
        left: 12px;
        font-size: 0.75rem;
        color: var(--danmaku-text-secondary);
    }

    .box:focus-within .label {
        color: var(--danmaku-primary);
    }

    input {
        display: block;
        width: 100%;
        box-sizing: border-box;
        padding: 0;
        border: none;
        outline: none;
        background: transparent;
        color: var(--danmaku-text);
        font: inherit;
        font-size: 0.95rem;
    }

    input::placeholder {
        color: var(--danmaku-text-secondary);
        opacity: 0.7;
    }

    .helper {
        display: block;
        margin: 4px 12px 0;
        font-size: 0.75rem;
        color: var(--danmaku-text-secondary);
    }
</style>
