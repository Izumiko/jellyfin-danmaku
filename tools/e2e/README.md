# 实机截图测试（Docker）

在真实 Jellyfin 播放页里加载构建好的脚本并截图，用于检查 UI 改动。无需在系统中安装浏览器，只需要 Docker。

- Jellyfin：`jellyfin/jellyfin`（默认 latest；`JELLYFIN_IMAGE=jellyfin/jellyfin:10.10.7` 可测旧版）
- 浏览器：`mcr.microsoft.com/playwright`（自带 Chromium 及系统依赖）

```bash
bun run build:userscript
bun run e2e:setup              # 启动 Jellyfin、生成测试剧集、完成初始化（用户 test/test）
MOCK=1 bun run e2e             # 截图，弹弹Play API 用合成数据
bun run e2e                    # 截图，走真实 API（受默认代理配额影响）
MOCK=1 THEME=light TAG=light bun run e2e   # 面板打开后切换到 Light 主题
bun run e2e:teardown           # 删除容器和网络
```

截图输出到 `.e2e/shots/`，同时保存浏览器控制台日志 `<TAG>-console.log`。

说明：

- Playwright 的 Chromium 不含 H.264/AAC 解码器，测试片源是 VP9/Opus WebM。
- `MOCK=1` 会拦截所有 `/api/v2/` 请求，返回固定番剧与 900 条弹幕，便于检查渲染与即时生效。
- 脚本模拟 `<script defer>` 注入：在 `DOMContentLoaded` 后执行 `dist/jellyfin-danmaku.user.js`。
