<script lang="ts" module>
    type TabId = 'video' | 'display' | 'filter' | 'block' | 'more';
    // 同一页面会话内记住上次打开的标签页
    let lastTab: TabId = 'video';
</script>

<script lang="ts">
    import { onMount } from 'svelte';
    import '../styles/variables.css';
    import { danmakuState } from '../../core/state.svelte';
    import { eventBus } from '../../core/event-bus';
    import { BLOCK_KEYS, DEFAULT_CONFIG, DISPLAY_KEYS, FILTER_KEYS } from '../../core/config';
    import { exportSettings, parseSettingsBackup } from '../../core/backup';
    import { parseRuleLines } from '../../danmaku/shield';
    import { buildMisakaPrefix, splitMisakaPrefix, testApiConnection } from '../../services/misaka';
    import { showInputDialog, showTextDialog } from '../dialogs';
    import type { DanmakuConfig, SourceStats } from '../../types/index';
    import SwitchRow from './controls/SwitchRow.svelte';
    import SliderField from './controls/SliderField.svelte';
    import TextField from './controls/TextField.svelte';
    import SegmentedField from './controls/SegmentedField.svelte';
    import ChipGroup from './controls/ChipGroup.svelte';
    import TextAreaField from './controls/TextAreaField.svelte';

    let { onClose }: { onClose: () => void } = $props();

    const tabs: { id: TabId; label: string }[] = [
        { id: 'video', label: '当前视频' },
        { id: 'display', label: '显示' },
        { id: 'filter', label: '过滤' },
        { id: 'block', label: '屏蔽' },
        { id: 'more', label: '更多' },
    ];

    let activeTab = $state<TabId>(lastTab);
    let panelEl = $state<HTMLElement | undefined>();
    let account = $state('');
    let password = $state('');
    let loginPending = $state(false);
    let loginMessage = $state('');
    const misakaInitial = splitMisakaPrefix(danmakuState.customApiPrefix);
    let misakaBase = $state(misakaInitial?.base ?? '');
    let misakaToken = $state(misakaInitial?.token ?? '');
    let apiTestLines = $state<string[]>([]);
    let apiTesting = $state(false);
    let backupMessage = $state('');

    const update = (patch: Partial<DanmakuConfig>) => danmakuState.update(patch);
    const percent = (v: number) => `${Math.round(v * 100)}%`;

    function selectTab(id: TabId) {
        activeTab = id;
        lastTab = id;
    }

    function resetKeys(keys: readonly (keyof DanmakuConfig)[]) {
        const patch: Partial<DanmakuConfig> = {};
        for (const key of keys) {
            const value = DEFAULT_CONFIG[key];
            (patch as Record<string, unknown>)[key] = typeof value === 'object' ? { ...value } : value;
        }
        update(patch);
    }

    function formatStats(stats: SourceStats | null): string {
        if (!stats) return '';
        const parts = [
            [stats.bilibili, 'B站'],
            [stats.gamer, '巴哈'],
            [stats.dandanplay, '弹弹'],
            [stats.other, '其他'],
        ]
            .filter(([count]) => (count as number) > 0)
            .map(([count, label]) => `${label} ${count}`);
        return parts.join(' / ');
    }

    function applyMisaka() {
        const prefix = buildMisakaPrefix(misakaBase, misakaToken);
        if (!prefix) {
            apiTestLines = ['请填写服务地址和客户端 token'];
            return;
        }
        // 御坂网络自身处理跨域，不经过默认 CORS 代理
        update({ customApiPrefix: prefix, customCorsProxy: '' });
        apiTestLines = [`已切换到 ${prefix}`];
    }

    async function testApi() {
        apiTesting = true;
        apiTestLines = ['测试中…'];
        try {
            apiTestLines = await testApiConnection(danmakuState.effectiveApiPrefix, danmakuState.episodeInfo?.animeTitle || danmakuState.currentTitle);
        } finally {
            apiTesting = false;
        }
    }

    async function exportAll() {
        await showTextDialog('导出全部弹幕设置', exportSettings(danmakuState.toConfig()), true);
    }

    async function importAll() {
        const text = await showTextDialog('粘贴设置 JSON（也支持 ede.js 导出的备份）');
        if (!text) return;
        try {
            const settings = parseSettingsBackup(text);
            update(settings);
            backupMessage = `已导入 ${Object.keys(settings).length} 项设置`;
        } catch (error) {
            backupMessage = `导入失败：${error instanceof Error ? error.message : String(error)}`;
        }
    }

    function setOffset(value: number) {
        if (!Number.isFinite(value)) return;
        // 保留一位小数，避免 0.1 步进累计出浮点误差
        update({ curEpOffset: Math.round(value * 10) / 10 });
    }

    async function handleAddSource() {
        const url = await showInputDialog('增加弹幕源', '如 B 站视频或番剧播放页链接', '');
        if (url) eventBus.emit('danmaku:add-source', { url });
    }

    function handleLogin(e: SubmitEvent) {
        e.preventDefault();
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
        loginMessage = '';
        password = '';
        eventBus.emit('auth:logout', undefined);
    }

    // 面板内按键不传给 Jellyfin 播放器热键（空格暂停、方向键快进等）
    function isolateKeys(e: KeyboardEvent) {
        e.stopPropagation();
        if (e.key === 'Escape' && !document.querySelector('[role="dialog"][aria-modal="true"]')) {
            e.preventDefault();
            onClose();
        }
    }

    function stopPlayerGestures(e: Event) {
        e.stopPropagation();
    }

    onMount(() => {
        panelEl?.focus();
        return eventBus.on('auth:login-result', ({ success }) => {
            loginPending = false;
            if (success) {
                password = '';
                loginMessage = '';
            } else {
                loginMessage = '登录失败，请检查账号、密码或网络';
            }
        });
    });
</script>

<!-- 透明遮罩：点击面板外关闭，同时避免误触暂停视频；不压暗画面以便实时预览 -->
<div class="backdrop" role="presentation" onclick={onClose} onpointerdown={stopPlayerGestures}></div>

<div
    class="panel"
    role="dialog"
    aria-label="弹幕设置"
    tabindex="-1"
    bind:this={panelEl}
    onkeydown={isolateKeys}
    onpointerdown={stopPlayerGestures}
    onpointermove={stopPlayerGestures}
    onpointerup={stopPlayerGestures}
    onmousedown={stopPlayerGestures}
    onmousemove={stopPlayerGestures}
    onmouseup={stopPlayerGestures}
    ontouchstart={stopPlayerGestures}
    ontouchmove={stopPlayerGestures}
    onwheel={stopPlayerGestures}
    onclick={stopPlayerGestures}
>
    <header>
        <h2>弹幕设置</h2>
        <button type="button" class="icon-button" aria-label="关闭" title="关闭" onclick={onClose}>
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                <path fill="currentColor" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
        </button>
    </header>

    <div class="tabs" role="tablist">
        {#each tabs as tab (tab.id)}
            <button type="button" role="tab" aria-selected={activeTab === tab.id} class:active={activeTab === tab.id} onclick={() => selectTab(tab.id)}>
                {tab.label}
            </button>
        {/each}
    </div>

    <div class="content" role="tabpanel">
        {#if activeTab === 'video'}
            <section class="card">
                {#if danmakuState.loading}
                    <div class="card-title">正在加载弹幕…</div>
                {:else if danmakuState.loadError}
                    <div class="card-title error-title">弹幕加载失败</div>
                    <div class="card-subtitle">{danmakuState.loadError}</div>
                    <div class="card-subtitle">默认代理不可用时，可在「更多」中填写自己的 CORS 代理或 API。</div>
                {:else if danmakuState.loadedSource === 'online' && danmakuState.episodeInfo}
                    <div class="card-title">{danmakuState.episodeInfo.animeTitle}</div>
                    <div class="card-subtitle">{danmakuState.episodeInfo.episodeTitle}</div>
                {:else if danmakuState.loadedSource === 'local'}
                    <div class="card-title">本地 XML 弹幕</div>
                    <div class="card-subtitle">来自 Jellyfin 弹幕插件</div>
                {:else}
                    <div class="card-title">尚未匹配到弹幕</div>
                    <div class="card-subtitle">可手动搜索番剧，或直接增加弹幕源</div>
                {/if}
                {#if danmakuState.loadedSource && !danmakuState.loading}
                    <div class="card-meta">
                        共 {danmakuState.loadedCount} 条 · 当前显示 {danmakuState.visibleCount} 条{danmakuState.blockedCount > 0 ? ` · 已屏蔽 ${danmakuState.blockedCount} 条` : ''}
                    </div>
                    {#if formatStats(danmakuState.sourceStats)}
                        <div class="card-meta">{formatStats(danmakuState.sourceStats)}</div>
                    {/if}
                {/if}
                <div class="card-actions">
                    {#if danmakuState.loadError && !danmakuState.loading}
                        <button type="button" class="button contained" onclick={() => eventBus.emit('danmaku:reload', { reason: 'refresh' })}>重试</button>
                    {/if}
                    <button
                        type="button"
                        class="button {danmakuState.loadError ? 'outlined' : 'contained'}"
                        onclick={() => eventBus.emit('danmaku:reload', { reason: 'search' })}
                    >
                        手动匹配
                    </button>
                    <button type="button" class="button outlined" onclick={handleAddSource}>增加弹幕源</button>
                </div>
                {#if danmakuState.loadedSource && !danmakuState.loading}
                    <button type="button" class="button text reload" onclick={() => eventBus.emit('danmaku:reload', { reason: 'reload' })}>重新加载</button>
                {/if}
            </section>

            <h3>时间偏移</h3>
            <p class="hint">仅对当前这一集生效，后续未单独设置的集数会沿用。正数表示弹幕延后出现。</p>
            <div class="offset">
                <button type="button" class="button outlined small" onclick={() => setOffset(danmakuState.curEpOffset - 1)}>−1s</button>
                <button type="button" class="button outlined small" onclick={() => setOffset(danmakuState.curEpOffset - 0.1)}>−0.1</button>
                <label class="offset-value">
                    <input
                        type="number"
                        step="0.1"
                        value={danmakuState.curEpOffset}
                        aria-label="偏移秒数"
                        onchange={(e) => setOffset(Number(e.currentTarget.value))}
                    />
                    <span>秒</span>
                </label>
                <button type="button" class="button outlined small" onclick={() => setOffset(danmakuState.curEpOffset + 0.1)}>+0.1</button>
                <button type="button" class="button outlined small" onclick={() => setOffset(danmakuState.curEpOffset + 1)}>+1s</button>
            </div>
            {#if danmakuState.curEpOffset !== 0}
                <button type="button" class="button text" onclick={() => setOffset(0)}>归零</button>
            {/if}
        {/if}

        {#if activeTab === 'display'}
            <SwitchRow label="显示弹幕" checked={danmakuState.danmakuSwitch} onchange={(v) => update({ danmakuSwitch: v })} />
            <SliderField label="不透明度" value={danmakuState.opacity} min={0} max={1} step={0.05} format={percent} oninput={(v) => update({ opacity: v })} />
            <SliderField label="字号" value={danmakuState.fontSize} min={8} max={80} step={1} format={(v) => `${v}px`} oninput={(v) => update({ fontSize: v })} />
            <SliderField label="滚动速度" value={danmakuState.speed} min={20} max={600} step={10} format={(v) => `${v}px/s`} oninput={(v) => update({ speed: v })} />
            <SliderField label="显示区域" value={danmakuState.heightRatio} min={0} max={1} step={0.05} format={percent} oninput={(v) => update({ heightRatio: v })} />
            <SegmentedField
                label="密度限制"
                value={danmakuState.densityLimit}
                options={[
                    { value: 0, label: '不限制' },
                    { value: 1, label: '宽松' },
                    { value: 2, label: '适中' },
                    { value: 3, label: '严格' },
                ]}
                onchange={(v) => update({ densityLimit: v })}
            />
            <SwitchRow
                label="防重叠"
                description="丢弃会与已有弹幕重叠的弹幕"
                checked={danmakuState.useAntiOverlap}
                onchange={(v) => update({ useAntiOverlap: v })}
            />
            <TextField label="字体" value={danmakuState.fontFamily} placeholder="sans-serif" onchange={(v) => update({ fontFamily: v.trim() || DEFAULT_CONFIG.fontFamily })} />
            <TextField label="字体选项" value={danmakuState.fontOptions} placeholder="如 bold、italic" onchange={(v) => update({ fontOptions: v.trim() })} />
            <div class="footer-actions">
                <button type="button" class="button text" onclick={() => resetKeys(DISPLAY_KEYS)}>恢复默认</button>
            </div>
        {/if}

        {#if activeTab === 'filter'}
            <ChipGroup
                label="弹幕来源"
                description="取消选择即屏蔽该来源"
                items={[
                    { key: 'bilibili', label: 'B站' },
                    { key: 'gamer', label: '巴哈姆特' },
                    { key: 'dandanplay', label: '弹弹Play' },
                    { key: 'other', label: '其他' },
                ]}
                values={danmakuState.sourceFilter}
                onchange={(v) => update({ sourceFilter: v })}
            />
            <ChipGroup
                label="弹幕类型"
                items={[
                    { key: 'scroll', label: '滚动' },
                    { key: 'top', label: '顶部' },
                    { key: 'bottom', label: '底部' },
                ]}
                values={danmakuState.modeFilter}
                onchange={(v) => update({ modeFilter: v })}
            />
            <div class="footer-actions">
                <button type="button" class="button text" onclick={() => resetKeys(FILTER_KEYS)}>恢复默认</button>
            </div>
        {/if}

        {#if activeTab === 'block'}
            <p class="hint">每行一条规则，# 开头为注释。关键词按「包含」匹配，同时匹配正文和发送者；写成 /正则/i 或 re:正则 按正则匹配。</p>
            <SwitchRow label="屏蔽关键词" description="{parseRuleLines(danmakuState.blockKeywords).length} 条规则" checked={danmakuState.blockEnableKeywords} onchange={(v) => update({ blockEnableKeywords: v })} />
            <TextAreaField
                label="关键词 / 正则"
                value={danmakuState.blockKeywords}
                placeholder="剧透&#10;/^前方高能/"
                disabled={!danmakuState.blockEnableKeywords}
                onchange={(v) => update({ blockKeywords: v })}
            />
            <SwitchRow label="屏蔽发送者" description="{parseRuleLines(danmakuState.blockUsers).length} 条规则" checked={danmakuState.blockEnableUsers} onchange={(v) => update({ blockEnableUsers: v })} />
            <TextAreaField
                label="发送者（包含即屏蔽）"
                value={danmakuState.blockUsers}
                placeholder="[BiliBili]&#10;某个用户 id"
                rows={2}
                disabled={!danmakuState.blockEnableUsers}
                onchange={(v) => update({ blockUsers: v })}
            />
            <SwitchRow label="屏蔽颜色" checked={danmakuState.blockEnableColors} onchange={(v) => update({ blockEnableColors: v })} />
            {#if danmakuState.blockEnableColors}
                <TextField label="颜色（逗号分隔）" value={danmakuState.blockColors} placeholder="ff0000, #00ff00" onchange={(v) => update({ blockColors: v })} />
            {/if}

            <h3>整理</h3>
            <SwitchRow
                label="去掉点赞数"
                description="去掉第三方 API 拼在正文尾部的「🤍 28」"
                checked={danmakuState.stripLikeSuffix}
                onchange={(v) => update({ stripLikeSuffix: v })}
            />
            <SwitchRow
                label="合并相似弹幕"
                description="2 秒内相似的弹幕合并为一条并标注 [xN]"
                checked={danmakuState.mergeSimilar}
                onchange={(v) => update({ mergeSimilar: v })}
            />
            {#if danmakuState.mergeSimilar}
                <SliderField label="相似度阈值" value={danmakuState.mergeThreshold} min={50} max={100} step={1} format={(v) => `${v}%`} oninput={(v) => update({ mergeThreshold: v })} />
            {/if}
            {#if danmakuState.blockedCount > 0}
                <p class="hint">当前已屏蔽 {danmakuState.blockedCount} 条</p>
            {/if}
            <div class="footer-actions">
                <button type="button" class="button text" onclick={() => resetKeys(BLOCK_KEYS)}>恢复默认</button>
            </div>
        {/if}

        {#if activeTab === 'more'}
            <h3>弹弹Play 账号</h3>
            {#if danmakuState.ddplayLoggedIn}
                <div class="account">
                    <span>已登录{danmakuState.ddplayUserName ? `：${danmakuState.ddplayUserName}` : ''}</span>
                    <button type="button" class="button text" onclick={handleLogout}>退出登录</button>
                </div>
            {:else}
                <form onsubmit={handleLogin}>
                    <p class="hint">登录后可发送弹幕，增加的弹幕源也会提交给弹弹Play。</p>
                    <TextField label="账号" value={account} autocomplete="username" oninput={(v) => (account = v)} />
                    <TextField label="密码" type="password" value={password} autocomplete="current-password" oninput={(v) => (password = v)} />
                    {#if loginMessage}<p class="error">{loginMessage}</p>{/if}
                    <button type="submit" class="button contained" disabled={loginPending}>{loginPending ? '登录中…' : '登录'}</button>
                </form>
            {/if}

            <h3>弹幕源</h3>
            <SegmentedField
                label="简繁转换"
                value={danmakuState.chConvert}
                options={[
                    { value: 0, label: '原文' },
                    { value: 1, label: '简体' },
                    { value: 2, label: '繁体' },
                ]}
                onchange={(v) => update({ chConvert: v })}
            />
            <SwitchRow
                label="优先使用本地 XML 弹幕"
                description="需要 Jellyfin 弹幕插件（jellyfin-plugin-danmu）"
                checked={danmakuState.useXmlDanmaku}
                onchange={(v) => update({ useXmlDanmaku: v })}
            />
            {#if !danmakuState.useXmlDanmaku}
                <SwitchRow
                    label="匹配失败时使用插件弹幕"
                    description="在线搜索没有结果时，改用 Jellyfin 弹幕插件的弹幕"
                    checked={danmakuState.xmlFallback}
                    onchange={(v) => update({ xmlFallback: v })}
                />
            {/if}
            <TextField
                label="CORS 代理"
                value={danmakuState.customCorsProxy}
                placeholder="留空使用默认"
                type="url"
                onchange={(v) => update({ customCorsProxy: v.trim() })}
            />
            <TextField
                label="API 地址"
                value={danmakuState.customApiPrefix}
                placeholder="留空使用弹弹Play"
                type="url"
                helper="可填第三方弹幕库，如御坂网络：http://host:port/api/v1/<Token>"
                onchange={(v) => update({ customApiPrefix: v.trim() })}
            />

            <h3>御坂网络（misaka_danmu_server）</h3>
            <TextField label="服务地址" value={misakaBase} placeholder="http://192.168.1.10:7768" type="url" oninput={(v) => (misakaBase = v)} />
            <TextField label="客户端 token" value={misakaToken} placeholder="misaka 网页端里的调用令牌" oninput={(v) => (misakaToken = v)} />
            <div class="row-actions">
                <button type="button" class="button outlined" onclick={applyMisaka}>应用</button>
                <button type="button" class="button outlined" disabled={apiTesting} onclick={testApi}>测试连接</button>
            </div>
            {#if apiTestLines.length}
                <div class="test-result">
                    {#each apiTestLines as line, i (i)}<div>{line}</div>{/each}
                </div>
            {/if}

            <h3>设置备份</h3>
            <p class="hint">导出全部设置（含屏蔽规则与 API）为 JSON，换设备时导入。也可以导入 ede.js 导出的备份。</p>
            <div class="row-actions">
                <button type="button" class="button outlined" onclick={exportAll}>导出</button>
                <button type="button" class="button outlined" onclick={importAll}>导入</button>
            </div>
            {#if backupMessage}<p class="hint">{backupMessage}</p>{/if}

            <h3>调试</h3>
            <SwitchRow label="显示日志" checked={danmakuState.logSwitch} onchange={(v) => update({ logSwitch: v })} />
        {/if}
    </div>
</div>

<style>
    .backdrop {
        position: fixed;
        inset: 0;
        z-index: 9998;
        background: transparent;
    }

    .panel {
        position: fixed;
        top: 0;
        right: 0;
        bottom: 0;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        width: min(360px, 100vw);
        box-sizing: border-box;
        background: var(--danmaku-bg);
        color: var(--danmaku-text);
        font-family: var(--danmaku-font);
        box-shadow: var(--danmaku-shadow);
        outline: none;
        animation: slide-in 225ms cubic-bezier(0, 0, 0.2, 1);
    }

    @keyframes slide-in {
        from {
            transform: translateX(100%);
        }
    }

    /* 窄屏：改为底部抽屉，保留上方画面可见 */
    @media (max-width: 600px) {
        .panel {
            top: auto;
            left: 0;
            width: 100%;
            height: min(70vh, 560px);
            border-radius: 12px 12px 0 0;
            animation-name: slide-up;
        }

        @keyframes slide-up {
            from {
                transform: translateY(100%);
            }
        }
    }

    .panel :global(*) {
        box-sizing: border-box;
    }

    header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 8px 0 20px;
    }

    h2 {
        margin: 0;
        font-size: 1.25rem;
        font-weight: 500;
    }

    .icon-button {
        display: inline-flex;
        padding: 8px;
        border: none;
        border-radius: 50%;
        background: transparent;
        color: var(--danmaku-text);
        cursor: pointer;
    }

    .icon-button:hover {
        background: var(--danmaku-hover);
    }

    .tabs {
        display: flex;
        padding: 0 8px;
        border-bottom: 1px solid var(--danmaku-border);
    }

    .tabs button {
        flex: 1;
        min-width: 0;
        padding: 12px 8px;
        border: none;
        border-bottom: 2px solid transparent;
        background: transparent;
        color: var(--danmaku-text-secondary);
        font: inherit;
        font-size: 0.9rem;
        font-weight: 500;
        cursor: pointer;
        transition: color 150ms, border-color 150ms;
    }

    .tabs button:hover {
        background: var(--danmaku-hover);
    }

    .tabs button.active {
        color: var(--danmaku-primary);
        border-bottom-color: var(--danmaku-primary);
    }

    .content {
        flex: 1;
        overflow-y: auto;
        overscroll-behavior: contain;
        padding: 12px 20px 24px;
    }

    h3 {
        margin: 20px 0 4px;
        font-size: 0.8rem;
        font-weight: 500;
        color: var(--danmaku-primary);
    }

    h3:first-child {
        margin-top: 4px;
    }

    .hint {
        margin: 0 0 8px;
        font-size: 0.8rem;
        color: var(--danmaku-text-secondary);
        line-height: 1.5;
    }

    .error {
        margin: 4px 0 8px;
        font-size: 0.85rem;
        color: var(--danmaku-error);
    }

    .card {
        padding: 16px;
        border: 1px solid var(--danmaku-border);
        border-radius: var(--danmaku-radius);
    }

    .card-title {
        font-size: 1rem;
        font-weight: 500;
        overflow-wrap: anywhere;
    }

    .error-title {
        color: var(--danmaku-error);
    }

    .card-subtitle {
        margin-top: 2px;
        font-size: 0.85rem;
        color: var(--danmaku-text-secondary);
        overflow-wrap: anywhere;
    }

    .card-meta {
        margin-top: 8px;
        font-size: 0.8rem;
        color: var(--danmaku-text-secondary);
        font-variant-numeric: tabular-nums;
    }

    .card-actions {
        display: flex;
        gap: 8px;
        margin-top: 14px;
    }

    .card-actions .button {
        flex: 1;
        padding-left: 8px;
        padding-right: 8px;
        white-space: nowrap;
    }

    .button {
        min-height: 36px;
        padding: 6px 16px;
        border-radius: var(--danmaku-radius);
        font: inherit;
        font-size: 0.9rem;
        font-weight: 500;
        cursor: pointer;
        transition: background-color 150ms, box-shadow 150ms;
    }

    .button:disabled {
        opacity: 0.5;
        cursor: default;
    }

    .button.contained {
        border: none;
        background: var(--danmaku-primary);
        color: var(--danmaku-on-primary);
        box-shadow: 0 3px 1px -2px rgba(0, 0, 0, 0.2), 0 2px 2px rgba(0, 0, 0, 0.14), 0 1px 5px rgba(0, 0, 0, 0.12);
    }

    .button.contained:hover:not(:disabled) {
        background: var(--jf-palette-primary-dark, #00729a);
    }

    .button.outlined {
        border: 1px solid rgb(var(--danmaku-primary-channel) / 0.5);
        background: transparent;
        color: var(--danmaku-primary);
    }

    .button.outlined:hover,
    .button.text:hover {
        background: rgb(var(--danmaku-primary-channel) / 0.08);
    }

    .button.text {
        border: none;
        background: transparent;
        color: var(--danmaku-primary);
        padding: 6px 8px;
    }

    .button.small {
        min-height: 32px;
        padding: 4px 8px;
        font-size: 0.8rem;
    }

    .button:focus-visible {
        outline: 2px solid var(--danmaku-primary);
        outline-offset: 2px;
    }

    .offset {
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .offset-value {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 4px;
        min-width: 0;
        padding: 0 8px;
        border-radius: var(--danmaku-radius);
        background: var(--danmaku-input-bg);
    }

    .offset-value input {
        width: 100%;
        min-width: 0;
        height: 32px;
        border: none;
        outline: none;
        background: transparent;
        color: var(--danmaku-text);
        font: inherit;
        text-align: center;
        font-variant-numeric: tabular-nums;
    }

    .offset-value span {
        font-size: 0.8rem;
        color: var(--danmaku-text-secondary);
    }

    .reload {
        margin-top: 6px;
    }

    .row-actions {
        display: flex;
        gap: 8px;
        margin: 4px 0 8px;
    }

    .row-actions .button {
        flex: 1;
    }

    .test-result {
        padding: 8px 12px;
        border-radius: var(--danmaku-radius);
        background: var(--danmaku-input-bg);
        font-size: 0.8rem;
        line-height: 1.6;
        color: var(--danmaku-text-secondary);
        overflow-wrap: anywhere;
    }

    .footer-actions {
        display: flex;
        justify-content: flex-end;
        margin-top: 12px;
    }

    .account {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 4px 0;
    }

    form .button {
        width: 100%;
        margin-top: 4px;
    }
</style>
