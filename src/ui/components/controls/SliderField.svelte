<script lang="ts">
    let {
        label,
        value,
        min,
        max,
        step,
        format = (v: number) => String(v),
        oninput,
    }: {
        label: string;
        value: number;
        min: number;
        max: number;
        step: number;
        format?: (value: number) => string;
        oninput: (value: number) => void;
    } = $props();

    const percent = $derived(max > min ? ((value - min) / (max - min)) * 100 : 0);
</script>

<label class="slider-field">
    <span class="head">
        <span class="label">{label}</span>
        <span class="value">{format(value)}</span>
    </span>
    <input
        type="range"
        {min}
        {max}
        {step}
        {value}
        style="--percent: {percent}%"
        oninput={(e) => oninput(Number(e.currentTarget.value))}
    />
</label>

<style>
    .slider-field {
        display: block;
        padding: 6px 0 4px;
    }

    .head {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        font-size: 0.95rem;
    }

    .value {
        font-size: 0.85rem;
        color: var(--danmaku-text-secondary);
        font-variant-numeric: tabular-nums;
    }

    /* MUI Slider：4px 轨道（未选部分 38% 透明度），20px 滑块 */
    input {
        width: 100%;
        height: 28px;
        margin: 0;
        background: transparent;
        appearance: none;
        -webkit-appearance: none;
        cursor: pointer;
    }

    input::-webkit-slider-runnable-track {
        height: 4px;
        border-radius: 2px;
        background: linear-gradient(
            to right,
            var(--danmaku-primary) var(--percent),
            rgb(var(--danmaku-primary-channel) / 0.38) var(--percent)
        );
    }

    input::-moz-range-track {
        height: 4px;
        border-radius: 2px;
        background: rgb(var(--danmaku-primary-channel) / 0.38);
    }

    input::-moz-range-progress {
        height: 4px;
        border-radius: 2px;
        background: var(--danmaku-primary);
    }

    input::-webkit-slider-thumb {
        width: 20px;
        height: 20px;
        margin-top: -8px;
        border: none;
        border-radius: 50%;
        background: var(--danmaku-primary);
        appearance: none;
        -webkit-appearance: none;
        transition: box-shadow 150ms;
    }

    input::-moz-range-thumb {
        width: 20px;
        height: 20px;
        border: none;
        border-radius: 50%;
        background: var(--danmaku-primary);
        transition: box-shadow 150ms;
    }

    input:hover::-webkit-slider-thumb,
    input:focus-visible::-webkit-slider-thumb {
        box-shadow: 0 0 0 8px rgb(var(--danmaku-primary-channel) / 0.16);
    }

    input:hover::-moz-range-thumb,
    input:focus-visible::-moz-range-thumb {
        box-shadow: 0 0 0 8px rgb(var(--danmaku-primary-channel) / 0.16);
    }

    input:focus {
        outline: none;
    }
</style>
