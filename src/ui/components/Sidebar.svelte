<script lang="ts">
    import '../styles/variables.css';
    import '../styles/base.css';

    let { 
        open = $bindable(false),
        onSave = () => {},
        onCancel = () => {}
    } = $props<{
        open: boolean;
        onSave: () => void;
        onCancel: () => void;
    }>();

    function handleBackdropClick() {
        onCancel();
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') {
            onCancel();
        }
    }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
    <!-- 背景遮罩 -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="sidebar-backdrop" onclick={handleBackdropClick}></div>

    <!-- 侧边栏面板 -->
    <div class="sidebar-panel">
        <header class="sidebar-header">
            <h2>弹幕设置</h2>
            <div class="header-actions">
                <button class="btn-save" onclick={onSave}>保存</button>
                <button class="btn-cancel" onclick={onCancel}>取消</button>
            </div>
        </header>

        <div class="sidebar-content">
            <div class="setting-section">
                <h3>显示设置</h3>
                <p>设置功能正在开发中...</p>
            </div>
        </div>
    </div>
{/if}

<style>
    .sidebar-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        z-index: 9998;
        animation: fadeIn 0.3s;
    }

    @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
    }

    .sidebar-panel {
        position: fixed;
        top: 0;
        right: 0;
        bottom: 0;
        width: min(450px, 90vw);
        background: var(--danmaku-bg);
        backdrop-filter: blur(10px);
        z-index: 9999;
        display: flex;
        flex-direction: column;
        color: var(--danmaku-text);
        animation: slideIn 0.3s ease;
    }

    @keyframes slideIn {
        from { transform: translateX(100%); }
        to { transform: translateX(0); }
    }

    .sidebar-header {
        padding: 20px;
        border-bottom: 1px solid var(--danmaku-border);
        display: flex;
        justify-content: space-between;
        align-items: center;
    }

    .sidebar-header h2 {
        margin: 0;
        font-size: 20px;
        font-weight: 500;
    }

    .header-actions {
        display: flex;
        gap: 10px;
    }

    .header-actions button {
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        font-size: 14px;
        cursor: pointer;
        transition: background 0.2s;
    }

    .btn-save {
        background: var(--danmaku-primary);
        color: white;
    }

    .btn-save:hover {
        background: #0090c0;
    }

    .btn-cancel {
        background: transparent;
        color: var(--danmaku-text);
        border: 1px solid var(--danmaku-border);
    }

    .btn-cancel:hover {
        background: var(--danmaku-hover);
    }

    .sidebar-content {
        flex: 1;
        overflow-y: auto;
        padding: 20px;
    }

    .setting-section {
        margin-bottom: 24px;
    }

    .setting-section h3 {
        margin: 0 0 12px 0;
        font-size: 16px;
        font-weight: 500;
        color: var(--danmaku-primary);
    }
</style>
