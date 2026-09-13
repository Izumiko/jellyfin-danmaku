<script lang="ts">
    import { danmakuState } from '../../core/state.svelte';
    import { danmakuEngine } from '../../danmaku/engine';

    const icon = $derived(danmakuState.danmakuSwitch ? 'comment' : 'comments_disabled');
    const title = $derived(danmakuState.danmakuSwitch ? '关闭弹幕' : '开启弹幕');

    function toggle() {
        danmakuState.danmakuSwitch = !danmakuState.danmakuSwitch;
        danmakuState.persist();

        if (danmakuState.danmakuSwitch) {
            danmakuEngine.show();
        } else {
            danmakuEngine.hide();
        }
    }
</script>

<button type="button" class="paper-icon-button-light autoSize" {title} onclick={toggle}>
    <span class="material-icons {icon}" aria-hidden="true"></span>
</button>
