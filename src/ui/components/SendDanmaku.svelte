<script lang="ts">
    import { onMount } from 'svelte';
    import '../styles/variables.css';
    import { danmakuState } from '../../core/state.svelte';
    import { eventBus } from '../../core/event-bus';

    let open = $state(false);
    let account = $state('');
    let password = $state('');
    let text = $state('');
    let mode = $state<1 | 4 | 5>(1);
    let loginPending = $state(false);
    let sending = $state(false);
    let errorMessage = $state('');
    let useFontAwesome = $state(false);

    const disabled = $derived(!danmakuState.episodeInfo || danmakuState.loading);
    const iconClass = $derived(
        useFontAwesome
            ? 'xlargePaperIconButton material-icons fa-paper-plane'
            : 'xlargePaperIconButton material-icons send',
    );

    onMount(() => {
        const sample = document.querySelector('.material-icons');
        if (sample instanceof HTMLElement) {
            useFontAwesome = getComputedStyle(sample).fontFamily.includes('Font Awesome');
        }

        const unsubscribeLogin = eventBus.on('auth:login-result', ({ success }) => {
            loginPending = false;
            if (!success) {
                errorMessage = '登录失败，请检查账号、密码或网络';
            } else {
                password = '';
                errorMessage = '';
            }
        });

        const unsubscribeSend = eventBus.on('danmaku:send-result', ({ success, message }) => {
            sending = false;
            if (success) {
                text = '';
                errorMessage = '';
                open = false;
            } else {
                errorMessage = message || '发送弹幕失败';
            }
        });

        return () => {
            unsubscribeLogin();
            unsubscribeSend();
        };
    });

    function openDialog() {
        if (disabled) return;
        errorMessage = '';
        open = true;
    }

    function closeDialog() {
        if (loginPending || sending) return;
        open = false;
        errorMessage = '';
        password = '';
    }

    function handleWindowKeydown(e: KeyboardEvent) {
        if (!open) return;
        if (e.key === 'Escape') {
            e.stopImmediatePropagation();
            closeDialog();
        }
    }

    function stopHotkeys(e: KeyboardEvent) {
        e.stopPropagation();
    }

    function submitLogin(e: SubmitEvent) {
        e.preventDefault();
        if (!account.trim() || !password) {
            errorMessage = '请输入账号和密码';
            return;
        }
        loginPending = true;
        errorMessage = '';
        eventBus.emit('auth:login', { account: account.trim(), password });
    }

    function submitDanmaku(e: SubmitEvent) {
        e.preventDefault();
        if (!text.trim()) {
            errorMessage = '弹幕内容不能为空';
            return;
        }
        sending = true;
        errorMessage = '';
        eventBus.emit('danmaku:send', {
            text: text.trim(),
            mode,
            color: 0xffffff,
        });
    }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<button
    type="button"
    class="paper-icon-button-light autoSize"
    is="paper-icon-button-light"
    title="发送弹幕"
    aria-label="发送弹幕"
    {disabled}
    onclick={openDialog}
>
    <span class={iconClass} aria-hidden="true"></span>
</button>

{#if open}
    <div class="dialog-backdrop" role="dialog" aria-modal="true">
        <div class="dialog-panel" onkeydown={stopHotkeys}>
            {#if danmakuState.ddplayLoggedIn}
                <form onsubmit={submitDanmaku} autocomplete="off">
                    <h3>发送弹幕</h3>
                    <div class="match-info">
                        <div>当前番剧：{danmakuState.episodeInfo?.animeTitle ?? ''}</div>
                        <div>当前集数：{danmakuState.episodeInfo?.episodeTitle ?? ''}</div>
                    </div>

                    <div class="mode-row">
                        <label><input type="radio" name="send-mode" value={1} bind:group={mode} />滚动</label>
                        <label><input type="radio" name="send-mode" value={4} bind:group={mode} />底部</label>
                        <label><input type="radio" name="send-mode" value={5} bind:group={mode} />顶部</label>
                    </div>

                    <input
                        class="text-input"
                        bind:value={text}
                        placeholder="请输入弹幕内容"
                        maxlength="300"
                        autofocus
                        onkeydown={stopHotkeys}
                    />

                    {#if errorMessage}
                        <div class="error-message">{errorMessage}</div>
                    {/if}

                    <div class="dialog-actions">
                        <button type="submit" class="primary" disabled={sending}>
                            {sending ? '发送中…' : '发送'}
                        </button>
                        <button type="button" onclick={closeDialog} disabled={sending}>取消</button>
                    </div>
                </form>
            {:else}
                <form onsubmit={submitLogin}>
                    <h3>登录弹弹Play</h3>
                    <p class="hint">发送弹幕需要先登录弹弹Play账号。</p>

                    <label class="field">
                        <span>账号</span>
                        <input bind:value={account} autocomplete="username" onkeydown={stopHotkeys} />
                    </label>
                    <label class="field">
                        <span>密码</span>
                        <input
                            type="password"
                            bind:value={password}
                            autocomplete="current-password"
                            onkeydown={stopHotkeys}
                        />
                    </label>

                    {#if errorMessage}
                        <div class="error-message">{errorMessage}</div>
                    {/if}

                    <div class="dialog-actions">
                        <button type="submit" class="primary" disabled={loginPending}>
                            {loginPending ? '登录中…' : '登录'}
                        </button>
                        <button type="button" onclick={closeDialog} disabled={loginPending}>取消</button>
                    </div>
                </form>
            {/if}
        </div>
    </div>
{/if}

<style>
    button:disabled {
        opacity: 0.45;
        cursor: default;
    }

    .dialog-backdrop {
        position: fixed;
        inset: 0;
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.5);
    }

    .dialog-panel {
        width: min(460px, 90vw);
        padding: 20px;
        box-sizing: border-box;
        background: var(--danmaku-bg, rgba(30, 30, 30, 0.96));
        color: var(--danmaku-text, #e0e0e0);
        border: 1px solid var(--danmaku-border, rgba(255, 255, 255, 0.1));
        border-radius: var(--danmaku-radius, 8px);
        box-shadow: var(--danmaku-shadow, 0 4px 12px rgba(0, 0, 0, 0.3));
    }

    h3 {
        margin: 0 0 14px;
        font-size: 17px;
        font-weight: 500;
    }

    .hint,
    .match-info {
        margin: 0 0 14px;
        opacity: 0.8;
        font-size: 13px;
        line-height: 1.6;
    }

    .field {
        display: grid;
        grid-template-columns: 52px 1fr;
        align-items: center;
        gap: 10px;
        margin: 10px 0;
    }

    .field input,
    .text-input {
        width: 100%;
        box-sizing: border-box;
        padding: 9px 12px;
        background: rgba(0, 0, 0, 0.3);
        color: var(--danmaku-text, #e0e0e0);
        border: 1px solid var(--danmaku-border, rgba(255, 255, 255, 0.1));
        border-radius: 4px;
        font-size: 14px;
    }

    .mode-row {
        display: flex;
        gap: 18px;
        margin: 12px 0;
    }

    .mode-row label {
        display: flex;
        align-items: center;
        gap: 5px;
        cursor: pointer;
    }

    .error-message {
        margin-top: 10px;
        font-size: 13px;
        color: #ff8a80;
    }

    .dialog-actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 16px;
    }

    .dialog-actions button {
        padding: 8px 16px;
        border-radius: 4px;
        border: 1px solid var(--danmaku-border, rgba(255, 255, 255, 0.1));
        background: transparent;
        color: var(--danmaku-text, #e0e0e0);
        cursor: pointer;
    }

    .dialog-actions .primary {
        border: none;
        background: var(--danmaku-primary, #00a4dc);
        color: white;
    }
</style>
