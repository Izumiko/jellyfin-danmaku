<script lang="ts">
    import { onMount } from 'svelte';
    import { danmakuState } from '../../core/state.svelte';
    import { eventBus } from '../../core/event-bus';

    let useFontAwesome = $state(false);

    const toggleTitle = $derived(danmakuState.danmakuSwitch ? '关闭弹幕' : '开启弹幕');
    const toggleIcon = $derived(
        useFontAwesome
            ? danmakuState.danmakuSwitch
                ? 'fa-comment'
                : 'fa-comment-slash'
            : danmakuState.danmakuSwitch
              ? 'comment'
              : 'comments_disabled',
    );
    const settingsIcon = $derived(useFontAwesome ? 'fa-sliders' : 'tune');

    onMount(() => {
        const sample = document.querySelector('.material-icons');
        if (sample instanceof HTMLElement) {
            useFontAwesome = getComputedStyle(sample).fontFamily.includes('Font Awesome');
        }
    });

    function toggle() {
        danmakuState.update({ danmakuSwitch: !danmakuState.danmakuSwitch });
    }
</script>

<button type="button" class="paper-icon-button-light autoSize" is="paper-icon-button-light" title={toggleTitle} aria-label={toggleTitle} onclick={toggle}>
    <span class="xlargePaperIconButton material-icons {toggleIcon}" aria-hidden="true"></span>
</button>
<button
    type="button"
    class="paper-icon-button-light autoSize"
    is="paper-icon-button-light"
    title="弹幕设置"
    aria-label="弹幕设置"
    onclick={() => eventBus.emit('settings:open', undefined)}
>
    <span class="xlargePaperIconButton material-icons {settingsIcon}" aria-hidden="true"></span>
</button>
