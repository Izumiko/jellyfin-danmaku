<script lang="ts">
    import { onMount } from 'svelte';
    import '../styles/variables.css';
    import { eventBus } from '../../core/event-bus';

    const DURATION_MS = 3500;

    let message = $state('');
    let tone = $state<'info' | 'error'>('info');
    let visible = $state(false);
    let timer: ReturnType<typeof setTimeout> | undefined;

    onMount(() => {
        const off = eventBus.on('ui:toast', (toast) => {
            message = toast.message;
            tone = toast.tone ?? 'info';
            visible = true;
            clearTimeout(timer);
            timer = setTimeout(() => (visible = false), DURATION_MS);
        });
        return () => {
            off();
            clearTimeout(timer);
        };
    });
</script>

<div class="snackbar" class:visible class:error={tone === 'error'} role="status" aria-live="polite">
    {message}
</div>

<style>
    /* MUI Snackbar：底部居中，位于 Jellyfin OSD 控制栏上方 */
    .snackbar {
        position: fixed;
        left: 50%;
        bottom: 7.5em;
        z-index: 10001;
        max-width: min(560px, calc(100vw - 32px));
        padding: 10px 16px;
        border-radius: var(--danmaku-radius);
        background: var(--danmaku-snackbar-bg);
        color: var(--danmaku-snackbar-text);
        font-family: var(--danmaku-font);
        font-size: 0.875rem;
        line-height: 1.43;
        box-shadow: 0 3px 5px -1px rgba(0, 0, 0, 0.2), 0 6px 10px rgba(0, 0, 0, 0.14), 0 1px 18px rgba(0, 0, 0, 0.12);
        pointer-events: none;
        opacity: 0;
        transform: translate(-50%, 8px);
        transition: opacity 200ms, transform 200ms;
        overflow-wrap: anywhere;
    }

    .snackbar.visible {
        opacity: 1;
        transform: translate(-50%, 0);
    }

    .snackbar.error {
        border-left: 4px solid var(--danmaku-error);
    }
</style>
