<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import { logger } from '../../core/logger';
    import { danmakuState } from '../../core/state.svelte';
    import type { LogEntry, LogLevel } from '../../types/index';

    let entries = $state<LogEntry[]>([]);
    let intervalId: number | undefined;
    let overlayEl = $state<HTMLDivElement | undefined>();
    let contentEl = $state<HTMLDivElement | undefined>();

    const levelLabels: Record<LogLevel, string> = {
        0: 'DEBUG',
        1: 'INFO',
        2: 'WARN',
        3: 'ERROR',
    };

    const levelColors: Record<LogLevel, string> = {
        0: '#888',
        1: '#0f0',
        2: '#ff0',
        3: '#f44',
    };

    function refresh() {
        entries = logger.getRecent(50);
    }

    $effect(() => {
        if (danmakuState.logSwitch) {
            refresh();
        }
    });

    function stopVolumeWheel(e: WheelEvent) {
        e.stopPropagation();
        e.preventDefault();
    }

    function onWindowWheelCapture(e: WheelEvent) {
        if (!overlayEl?.contains(e.target as Node)) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        if (contentEl) contentEl.scrollTop += e.deltaY;
    }

    onMount(() => {
        refresh();
        intervalId = window.setInterval(refresh, 500);
        window.addEventListener('wheel', onWindowWheelCapture, { capture: true, passive: false });
    });

    onDestroy(() => {
        if (intervalId !== undefined) {
            clearInterval(intervalId);
        }
        window.removeEventListener('wheel', onWindowWheelCapture, { capture: true });
    });
</script>

{#if danmakuState.logSwitch}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="debug-overlay" bind:this={overlayEl} onwheel={stopVolumeWheel}>
        <div class="debug-header">
            <span>调试日志 ({entries.length})</span>
            <button
                class="clear-btn"
                onclick={() => {
                    logger.clear();
                    refresh();
                }}>清空</button
            >
        </div>
        <div class="debug-content" bind:this={contentEl}>
            {#if entries.length === 0}
                <div class="debug-empty">暂无日志</div>
            {:else}
                {#each entries as entry, index (`${entry.timestamp}-${index}`)}
                    <div class="debug-entry">
                        <span class="debug-time">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                        <span class="debug-level" style="color: {levelColors[entry.level]}">
                            {levelLabels[entry.level]}
                        </span>
                        <span class="debug-module">[{entry.module}]</span>
                        <span class="debug-message">{entry.message}</span>
                    </div>
                {/each}
            {/if}
        </div>
    </div>
{/if}

<style>
    .debug-overlay {
        background: rgba(28, 28, 28, 0.9);
        color: #fff;
        padding: 12px;
        border-radius: 6px;
        max-height: 300px;
        width: 350px;
        display: flex;
        flex-direction: column;
        font-family: monospace;
        font-size: 12px;
        backdrop-filter: blur(4px);
        pointer-events: auto;
    }

    .debug-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding-bottom: 8px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        margin-bottom: 8px;
    }

    .clear-btn {
        background: transparent;
        border: 1px solid rgba(255, 255, 255, 0.3);
        color: #fff;
        padding: 2px 8px;
        border-radius: 3px;
        cursor: pointer;
        font-size: 11px;
    }

    .clear-btn:hover {
        background: rgba(255, 255, 255, 0.1);
    }

    .debug-content {
        flex: 1;
        min-height: 80px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .debug-empty {
        color: #aaa;
        padding: 8px 0;
    }

    .debug-entry {
        display: flex;
        gap: 6px;
        align-items: baseline;
        line-height: 1.4;
    }

    .debug-time {
        color: #888;
        font-size: 11px;
        white-space: nowrap;
    }

    .debug-level {
        font-size: 10px;
        font-weight: bold;
        white-space: nowrap;
        min-width: 40px;
    }

    .debug-module {
        color: #aaa;
        white-space: nowrap;
    }

    .debug-message {
        color: #fff;
        word-break: break-word;
    }
</style>
