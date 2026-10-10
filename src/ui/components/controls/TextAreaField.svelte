<script lang="ts">
    /** MUI filled 风格多行输入，失焦时提交 */
    let {
        label,
        value,
        placeholder = '',
        rows = 4,
        disabled = false,
        onchange,
    }: {
        label: string;
        value: string;
        placeholder?: string;
        rows?: number;
        disabled?: boolean;
        onchange: (value: string) => void;
    } = $props();
</script>

<label class="textarea-field" class:disabled>
    <span class="label">{label}</span>
    <textarea {rows} {value} {placeholder} {disabled} spellcheck="false" onchange={(e) => onchange(e.currentTarget.value)}></textarea>
</label>

<style>
    .textarea-field {
        position: relative;
        display: block;
        margin: 8px 0;
        padding: 22px 12px 6px;
        border-radius: 4px 4px 0 0;
        background: var(--danmaku-input-bg);
        border-bottom: 1px solid var(--danmaku-text-secondary);
        transition: background-color 150ms, opacity 150ms;
    }

    .textarea-field:hover {
        background: var(--danmaku-hover);
    }

    .textarea-field:focus-within {
        border-bottom: 2px solid var(--danmaku-primary);
        padding-bottom: 5px;
    }

    .textarea-field.disabled {
        opacity: 0.5;
    }

    .label {
        position: absolute;
        top: 6px;
        left: 12px;
        font-size: 0.75rem;
        color: var(--danmaku-text-secondary);
    }

    .textarea-field:focus-within .label {
        color: var(--danmaku-primary);
    }

    textarea {
        display: block;
        width: 100%;
        box-sizing: border-box;
        padding: 0;
        border: none;
        outline: none;
        resize: vertical;
        background: transparent;
        color: var(--danmaku-text);
        font-family: ui-monospace, Consolas, monospace;
        font-size: 0.85rem;
        line-height: 1.5;
    }

    textarea::placeholder {
        color: var(--danmaku-text-secondary);
        opacity: 0.7;
    }
</style>
