<script lang="ts">
    // 简化的弹幕开关按钮组件
    let { visible = $bindable(true) } = $props<{ visible: boolean }>();

    function toggle() {
        visible = !visible;
    }

    const icon = $derived(visible ? 'comment' : 'comments_disabled');
    const title = $derived(visible ? '关闭弹幕' : '开启弹幕');
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
