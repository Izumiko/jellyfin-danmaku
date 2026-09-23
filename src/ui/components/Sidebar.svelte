<script lang="ts">
    import { onMount } from 'svelte';
    import '../styles/variables.css';
    import '../styles/base.css';
    import { danmakuState } from '../../core/state.svelte';
    import { logger } from '../../core/logger';
    import { eventBus } from '../../core/event-bus';
    import { showInputDialog } from '../dialogs';

    let {
        open = $bindable(false),
        onSave = () => {},
        onCancel = () => {},
    } = $props<{
        open: boolean;
        onSave: () => void;
        onCancel: () => void;
    }>();

    let activeTab = $state('control');
    let account = $state('');
    let password = $state('');
    let loginPending = $state(false);
    let loginMessage = $state('');

    onMount(() => {
        return eventBus.on('auth:login-result', ({ success }) => {
            loginPending = false;
            if (success) {
                password = '';
                loginMessage = '登录成功';
            } else {
                loginMessage = '登录失败，请检查账号、密码或网络';
            }
        });
    });

    function handleLogin() {
        if (loginPending) return;
        if (!account.trim() || !password) {
            loginMessage = '请输入账号和密码';
            return;
        }
        loginPending = true;
        loginMessage = '';
        eventBus.emit('auth:login', { account: account.trim(), password });
    }

    function handleLogout() {
        loginPending = false;
        loginMessage = '';
        password = '';
        eventBus.emit('auth:logout', undefined);
    }

    function stopHotkeys(e: KeyboardEvent) {
        e.stopPropagation();
        if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
        }
    }

    function stopPlayerGestures(e: Event) {
        e.stopPropagation();
    }

    async function handleAddSource() {
        const url = await showInputDialog('增加弹幕源', '弹幕源 URL', '');
        if (!url) return;
        eventBus.emit('danmaku:add-source', { url });
    }

    function handleBackdropClick() {
        onCancel();
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') {
            if (document.querySelector('[role="dialog"]')) return;
            onCancel();
        }
    }

    function handleSave() {
        // 同步 logger 状态
        logger.setEnabled(danmakuState.logSwitch);
        onSave();
    }

    const tabs = [
        { id: 'control', label: '控制功能' },
        { id: 'style', label: '显示样式' },
        { id: 'display', label: '显示设置' },
        { id: 'filter', label: '过滤设置' },
    ];
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
    <!-- 背景遮罩 -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="sidebar-backdrop" onclick={handleBackdropClick}></div>

    <!-- 侧边栏面板 -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="sidebar-panel"
        onpointerdown={stopPlayerGestures}
        onpointermove={stopPlayerGestures}
        onpointerup={stopPlayerGestures}
        onmousedown={stopPlayerGestures}
        onmousemove={stopPlayerGestures}
        onmouseup={stopPlayerGestures}
        ontouchstart={stopPlayerGestures}
        ontouchmove={stopPlayerGestures}
        onwheel={stopPlayerGestures}
        onkeydown={stopHotkeys}
    >
        <header class="sidebar-header">
            <h2>弹幕设置</h2>
            <div class="header-actions">
                <button class="btn-save" onclick={handleSave}>保存</button>
                <button class="btn-cancel" onclick={onCancel}>取消</button>
            </div>
        </header>

        <div class="tabs-header">
            {#each tabs as tab (tab.id)}
                <button class="tab-btn" class:active={activeTab === tab.id} onclick={() => (activeTab = tab.id)} type="button">
                    {tab.label}
                </button>
            {/each}
        </div>

        <div class="sidebar-content">
            {#if activeTab === 'control'}
                <div class="setting-section">
                    <h3>控制功能</h3>

                    <div class="setting-item">
                        <div class="switch-label">
                            <span>弹幕显示</span>
                            <label class="modern-switch">
                                <input
                                    type="checkbox"
                                    bind:checked={danmakuState.danmakuSwitch}
                                    onchange={() =>
                                        eventBus.emit('danmaku:visibility', {
                                            visible: danmakuState.danmakuSwitch,
                                        })}
                                />
                                <span class="modern-slider"></span>
                            </label>
                        </div>
                    </div>

                    <div class="setting-item">
                        <div class="switch-label">
                            <span>日志显示</span>
                            <label class="modern-switch">
                                <input
                                    type="checkbox"
                                    bind:checked={danmakuState.logSwitch}
                                    onchange={() => logger.setEnabled(danmakuState.logSwitch)}
                                />
                                <span class="modern-slider"></span>
                            </label>
                        </div>
                    </div>

                    <div class="setting-item">
                        <button class="action-btn" onclick={() => eventBus.emit('danmaku:reload', { reason: 'search' })}> 搜索弹幕 </button>
                    </div>

                    <div class="setting-item">
                        <button class="action-btn" type="button" onclick={handleAddSource}>增加弹幕源</button>
                    </div>

                    <div class="setting-item">
                        {#if danmakuState.ddplayLoggedIn}
                            <span>已登录：{danmakuState.ddplayUserName}</span>
                            <button class="action-btn" type="button" onclick={handleLogout}>登出</button>
                        {:else}
                            <label>
                                账号:
                                <input class="setting-input" bind:value={account} onkeydown={stopHotkeys} />
                            </label>
                            <label>
                                密码:
                                <input class="setting-input" type="password" bind:value={password} onkeydown={stopHotkeys} />
                            </label>
                            <button class="action-btn" type="button" disabled={loginPending} onclick={handleLogin}>
                                {loginPending ? '登录中…' : '登录'}
                            </button>
                        {/if}
                        {#if loginMessage}
                            <div class:login-error={!danmakuState.ddplayLoggedIn} class="login-message">{loginMessage}</div>
                        {/if}
                    </div>

                    <div class="setting-item">
                        <label>
                            CORS 代理:
                            <input type="text" class="setting-input" placeholder="留空使用默认" bind:value={danmakuState.customCorsProxy} onkeydown={stopHotkeys} />
                        </label>
                    </div>

                    <div class="setting-item">
                        <label>
                            API 地址:
                            <input type="text" class="setting-input" placeholder="留空使用默认" bind:value={danmakuState.customApiPrefix} onkeydown={stopHotkeys} />
                        </label>
                    </div>
                </div>
            {/if}

            {#if activeTab === 'style'}
                <div class="setting-section">
                    <h3>显示样式</h3>

                    <div class="setting-item">
                        <label>
                            透明度: {danmakuState.opacity}
                            <input type="range" min="0" max="1" step="0.1" bind:value={danmakuState.opacity} onpointerdown={stopPlayerGestures} />
                        </label>
                    </div>

                    <div class="setting-item">
                        <label>
                            弹幕速度: {danmakuState.speed}
                            <input type="range" min="20" max="600" step="10" bind:value={danmakuState.speed} onpointerdown={stopPlayerGestures} />
                        </label>
                    </div>

                    <div class="setting-item">
                        <label>
                            字体大小: {danmakuState.fontSize}px
                            <input type="range" min="8" max="80" step="1" bind:value={danmakuState.fontSize} onpointerdown={stopPlayerGestures} />
                        </label>
                    </div>

                    <div class="setting-item">
                        <label>
                            显示区域比例: {danmakuState.heightRatio}
                            <input type="range" min="0" max="1" step="0.05" bind:value={danmakuState.heightRatio} onpointerdown={stopPlayerGestures} />
                        </label>
                    </div>

                    <div class="setting-item">
                        <label>
                            字体:
                            <input type="text" class="setting-input" bind:value={danmakuState.fontFamily} />
                        </label>
                    </div>

                    <div class="setting-item">
                        <label>
                            字体选项:
                            <input type="text" class="setting-input" placeholder="如 bold" bind:value={danmakuState.fontOptions} />
                        </label>
                    </div>
                </div>
            {/if}

            {#if activeTab === 'display'}
                <div class="setting-section">
                    <h3>显示设置</h3>

                    <div class="setting-item">
                        <label>
                            弹幕密度限制:
                            <select bind:value={danmakuState.densityLimit}>
                                <option value={0}>无限制</option>
                                <option value={1}>低</option>
                                <option value={2}>中</option>
                                <option value={3}>高</option>
                            </select>
                        </label>
                    </div>

                    <div class="setting-item">
                        <div class="switch-label">
                            <span>弹幕防重叠</span>
                            <label class="modern-switch">
                                <input type="checkbox" bind:checked={danmakuState.useAntiOverlap} />
                                <span class="modern-slider"></span>
                            </label>
                        </div>
                    </div>

                    <div class="setting-item">
                        <label>
                            简繁转换:
                            <select bind:value={danmakuState.chConvert}>
                                <option value={0}>不转换</option>
                                <option value={1}>简体</option>
                                <option value={2}>繁体</option>
                            </select>
                        </label>
                    </div>

                    <div class="setting-item">
                        <div class="switch-label">
                            <span>使用本地 XML 弹幕</span>
                            <label class="modern-switch">
                                <input type="checkbox" bind:checked={danmakuState.useXmlDanmaku} />
                                <span class="modern-slider"></span>
                            </label>
                        </div>
                    </div>

                    <div class="setting-item">
                        <label>
                            弹幕偏移时间 (秒):
                            <input type="number" class="setting-input" step="0.1" bind:value={danmakuState.curEpOffset} />
                        </label>
                    </div>
                </div>
            {/if}

            {#if activeTab === 'filter'}
                <div class="setting-section">
                    <h3>过滤设置</h3>

                    <div class="setting-item">
                        <span class="group-label">来源过滤:</span>
                        <div class="checkbox-group">
                            <label>
                                <input type="checkbox" bind:checked={danmakuState.sourceFilter.bilibili} />
                                Bilibili
                            </label>
                            <label>
                                <input type="checkbox" bind:checked={danmakuState.sourceFilter.gamer} />
                                巴哈姆特
                            </label>
                            <label>
                                <input type="checkbox" bind:checked={danmakuState.sourceFilter.dandanplay} />
                                弹弹Play
                            </label>
                            <label>
                                <input type="checkbox" bind:checked={danmakuState.sourceFilter.other} />
                                其他
                            </label>
                        </div>
                    </div>

                    <div class="setting-item">
                        <span class="group-label">模式过滤:</span>
                        <div class="checkbox-group">
                            <label>
                                <input type="checkbox" bind:checked={danmakuState.modeFilter.scroll} />
                                滚动
                            </label>
                            <label>
                                <input type="checkbox" bind:checked={danmakuState.modeFilter.top} />
                                顶部
                            </label>
                            <label>
                                <input type="checkbox" bind:checked={danmakuState.modeFilter.bottom} />
                                底部
                            </label>
                        </div>
                    </div>
                </div>
            {/if}
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
        from {
            opacity: 0;
        }
        to {
            opacity: 1;
        }
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
        from {
            transform: translateX(100%);
        }
        to {
            transform: translateX(0);
        }
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

    .tabs-header {
        display: flex;
        border-bottom: 1px solid var(--danmaku-border);
        padding: 0 20px;
    }

    .tab-btn {
        padding: 12px 16px;
        background: transparent;
        border: none;
        border-bottom: 2px solid transparent;
        color: var(--danmaku-text);
        cursor: pointer;
        font-size: 14px;
        opacity: 0.7;
        transition: all 0.2s;
    }

    .tab-btn:hover {
        opacity: 1;
    }

    .tab-btn.active {
        opacity: 1;
        border-bottom-color: var(--danmaku-primary);
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
        margin: 0 0 16px 0;
        font-size: 16px;
        font-weight: 500;
        color: var(--danmaku-primary);
    }

    .setting-item {
        margin-bottom: 16px;
    }

    .setting-item label,
    .group-label {
        display: block;
        margin-bottom: 8px;
        font-size: 14px;
    }

    .setting-item input[type='range'] {
        width: 100%;
        height: 6px;
        border-radius: 3px;
        background: var(--danmaku-border);
        outline: none;
        appearance: none;
        -webkit-appearance: none;
    }

    .setting-item input[type='range']::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: var(--danmaku-primary);
        cursor: pointer;
    }

    .setting-input {
        width: 100%;
        padding: 8px 12px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid var(--danmaku-border);
        border-radius: 4px;
        color: var(--danmaku-text);
        font-size: 14px;
    }

    .setting-input:focus {
        outline: none;
        border-color: var(--danmaku-primary);
    }

    select {
        width: 100%;
        padding: 8px 12px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid var(--danmaku-border);
        border-radius: 4px;
        color: var(--danmaku-text);
        font-size: 14px;
    }

    .switch-label {
        display: flex !important;
        justify-content: space-between;
        align-items: center;
    }

    .modern-switch {
        position: relative;
        display: inline-block;
        width: 44px;
        height: 24px;
    }

    .modern-switch input {
        position: absolute;
        z-index: 2;
        opacity: 0;
        inset: 0;
        margin: 0;
        cursor: pointer;
        width: 100%;
        height: 100%;
    }

    .modern-slider {
        position: absolute;
        cursor: pointer;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(255, 255, 255, 0.2);
        transition: 0.3s;
        border-radius: 24px;
    }

    .modern-slider:before {
        position: absolute;
        content: '';
        height: 18px;
        width: 18px;
        left: 3px;
        bottom: 3px;
        background-color: white;
        transition: 0.3s;
        border-radius: 50%;
    }

    .modern-switch input:checked + .modern-slider {
        background-color: var(--danmaku-primary);
    }

    .modern-switch input:checked + .modern-slider:before {
        transform: translateX(20px);
    }

    .checkbox-group {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .checkbox-group label {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
    }

    .checkbox-group input[type='checkbox'] {
        width: 16px;
        height: 16px;
        accent-color: var(--danmaku-primary);
    }

    .action-btn {
        width: 100%;
        padding: 10px;
        background: var(--danmaku-primary);
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        transition: background 0.2s;
    }

    .action-btn:hover {
        background: #0090c0;
    }

    .login-message {
        margin-top: 8px;
        font-size: 13px;
        opacity: 0.85;
    }

    .login-error {
        color: #ff8a80;
    }

    .action-btn:disabled {
        opacity: 0.55;
        cursor: default;
    }
</style>
