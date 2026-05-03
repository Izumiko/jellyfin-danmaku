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

<button class="danmaku-toggle" onclick={toggle} {title} type="button">
    <span class="material-icons">{icon}</span>
</button>

<style>
    .danmaku-toggle {
        background: transparent;
        border: none;
        color: white;
        cursor: pointer;
        padding: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 4.2em;
        height: 4.2em;
    }

    .danmaku-toggle:hover {
        color: #00a4dc;
    }

    .material-icons {
        font-size: 1.72em;
    }
</style>
