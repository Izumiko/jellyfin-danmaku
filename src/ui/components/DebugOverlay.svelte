<script lang="ts">
    import { logger } from '../../core/logger';

    let { logs = [] } = $props<{ logs: Array<{ timestamp: number; message: string }> }>();
</script>

<div class="debug-overlay">
    {#each logs.slice(-10) as log (log.timestamp)}
        <div class="log-entry">
            {new Date(log.timestamp).toLocaleTimeString()}: {log.message}
        </div>
    {/each}
</div>

<style>
    .debug-overlay {
        position: absolute;
        top: 10px;
        left: 10px;
        background: rgba(0, 0, 0, 0.7);
        color: #0f0;
        font-family: monospace;
        font-size: 12px;
        padding: 8px;
        border-radius: 4px;
        max-width: 400px;
        pointer-events: none;
        z-index: 9999;
    }

    .log-entry {
        margin: 2px 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
</style>
