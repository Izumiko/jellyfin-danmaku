<script lang="ts">
    import { onMount } from 'svelte';
    import { danmakuState } from '../../core/state.svelte';
    import { eventBus } from '../../core/event-bus';

    let useFontAwesome = $state(false);

    const icon = $derived(danmakuState.danmakuSwitch ? 'comment' : 'comments_disabled');
    const title = $derived(danmakuState.danmakuSwitch ? '关闭弹幕' : '开启弹幕');
    const iconClass = $derived(
        useFontAwesome
            ? `xlargePaperIconButton material-icons ${danmakuState.danmakuSwitch ? 'fa-comment' : 'fa-comment-slash'}`
            : `xlargePaperIconButton material-icons ${icon}`,
    );

    onMount(() => {
        const sample = document.querySelector('.material-icons');
        if (sample instanceof HTMLElement) {
            useFontAwesome = getComputedStyle(sample).fontFamily.includes('Font Awesome');
        }
    });

    function toggle() {
        danmakuState.danmakuSwitch = !danmakuState.danmakuSwitch;
        danmakuState.persist();

        eventBus.emit('danmaku:visibility', { visible: danmakuState.danmakuSwitch });
    }
</script>

<button
    type="button"
    class="paper-icon-button-light autoSize"
    is="paper-icon-button-light"
    {title}
    aria-label={title}
    onclick={toggle}
>
    <span class={iconClass} aria-hidden="true"></span>
</button>
