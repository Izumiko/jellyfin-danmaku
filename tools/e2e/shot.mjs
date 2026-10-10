// 在 Playwright 容器内运行：登录 Jellyfin → 播放 → 截图弹幕控件与设置面板。由 run.sh 调用。
// 环境变量：
//   EPISODE_ID  要播放的剧集
//   MOCK=1      拦截弹弹Play API 并返回合成数据（不依赖代理配额/网络）
//   THEME       打开面板后把 <html data-theme> 切到该主题（Jellyfin 12：light、purplehaze…）
//   TAG         截图文件名前缀
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.JF_URL || 'http://jfdm-jellyfin:8096';
const EPISODE = process.env.EPISODE_ID;
const MOCK = process.env.MOCK === '1';
const THEME = process.env.THEME ?? '';
const TAG = process.env.TAG || (MOCK ? 'mock' : 'real');
const OUT = '/work/shots';
const SCRIPT = fs.readFileSync('/dist/jellyfin-danmaku.user.js', 'utf8');
fs.mkdirSync(OUT, { recursive: true });

const anime = {
    animeId: 18160,
    animeTitle: '葬送的芙莉莲',
    type: 'tvseries',
    typeDescription: 'TV动画',
    episodes: [
        { episodeId: 181600001, episodeTitle: '第1话 冒险的结束' },
        { episodeId: 181600002, episodeTitle: '第2话 不是非得用魔法不可' },
    ],
};

function fakeComments() {
    const users = ['[BiliBili]a1b2', '[Gamer]x9', 'ddp_user', '[AcFun]zz'];
    const texts = ['前方高能', '芙莉莲好可爱', '这一集神了', '名场面', 'BGM 太好听了', '哈哈哈哈哈', '泪目', '作画好评', '辛美尔！', '来了来了'];
    const colors = [16777215, 16777215, 16777215, 16711680, 65280, 16776960, 52479];
    return Array.from({ length: 900 }, (_, i) => {
        const mode = i % 17 === 0 ? 5 : i % 23 === 0 ? 4 : 1;
        return { cid: i, p: `${((i * 0.1) % 90).toFixed(2)},${mode},${colors[i % colors.length]},${users[i % users.length]}`, m: texts[i % texts.length] };
    });
}

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
// 模拟用户脚本 / <script defer> 注入：DOM 解析完成后执行
await context.addInitScript((code) => {
    document.addEventListener('DOMContentLoaded', () => new Function(code)());
}, SCRIPT);

if (MOCK) {
    await context.route(/\/api\/v2\//, (route) => {
        const url = route.request().url();
        const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ errorCode: 0, success: true, ...body }) });
        if (url.includes('/search/episodes')) return json({ hasMore: false, animes: [anime] });
        if (url.includes('/bangumi/')) return json({ bangumi: anime });
        if (url.includes('/related/')) return json({ relateds: [] });
        if (url.includes('/comment/')) return json({ count: 900, comments: fakeComments() });
        return json({});
    });
}

const page = await context.newPage();
const logs = [];
page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`));

const shot = async (name) => {
    await page.screenshot({ path: `${OUT}/${TAG}-${name}.png` });
    console.log('shot', `${TAG}-${name}`);
};
const wakeOsd = async () => {
    await page.mouse.move(700, 500);
    await page.mouse.move(720, 520);
    await page.waitForTimeout(400);
};

try {
    await page.goto(`${BASE}/web/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#txtManualName', { timeout: 30000 });
    await page.fill('#txtManualName', 'test');
    await page.fill('#txtManualPassword', 'test');
    await page.click('.manualLoginForm .button-submit');
    await page.waitForTimeout(4000);

    await page.goto(`${BASE}/web/#/details?id=${EPISODE}`);
    await page.waitForTimeout(4000);
    await page
        .locator('button.btnPlay:visible, button[data-action="resume"]:visible, button[title="播放"]:visible, button[aria-label="播放"]:visible, button[title="Play"]:visible')
        .first()
        .click({ timeout: 15000 });
    await page.waitForSelector('#danmakuCtr', { timeout: 30000 });

    await page.waitForTimeout(MOCK ? 2500 : 9000);
    await wakeOsd();
    await shot('01-player-toast');

    await page.waitForTimeout(4000);
    await shot('02-danmaku');

    await wakeOsd();
    await page.click('#danmakuCtr button[title="弹幕设置"]');
    await page.waitForTimeout(800);
    if (THEME) {
        await page.evaluate((theme) => document.documentElement.setAttribute('data-theme', theme), THEME);
        await page.waitForTimeout(300);
    }
    await shot('03-panel-video');

    for (const [label, name] of [
        ['显示', '04-panel-display'],
        ['过滤', '05-panel-filter'],
        ['更多', '06-panel-more'],
    ]) {
        await page.click(`[role="tab"]:has-text("${label}")`);
        await page.waitForTimeout(400);
        await shot(name);
    }

    if (MOCK) {
        // 即时生效：调大字号后不应出现空白期
        await page.click('[role="tab"]:has-text("显示")');
        await page.locator('[role="tabpanel"] input[type="range"]').nth(1).fill('34');
        await page.waitForTimeout(400);
        await shot('07-live-fontsize');
    }

    // 窄屏：底部抽屉
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 412, height: 860 });
    await page.waitForTimeout(800);
    await page.mouse.move(200, 400);
    await page.mouse.move(210, 420);
    await page.waitForTimeout(400);
    await page.click('#danmakuCtr button[title="弹幕设置"]');
    await page.waitForTimeout(800);
    await shot('08-mobile-panel');

    // 齿轮菜单入口
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(800);
    await wakeOsd();
    await page.click('.btnVideoOsdSettings');
    await page.waitForTimeout(800);
    await shot('09-gear-menu');
} catch (error) {
    console.error('FAILED:', error.message);
    await shot('99-error').catch(() => {});
    process.exitCode = 1;
} finally {
    fs.writeFileSync(`${OUT}/${TAG}-console.log`, logs.join('\n'));
    await browser.close();
}
