# ddplay Worker 部署说明

## 1. 准备环境

需要已安装 Node.js 和 pnpm：

```bash
node -v
pnpm -v
```

创建项目目录并安装 Wrangler：

```bash
mkdir ddplay-worker
cd ddplay-worker

pnpm init
pnpm add -D wrangler@latest
```

目录结构建议：

```text
ddplay-worker/
├── ddplay_worker.mjs
├── wrangler.toml
├── package.json
└── pnpm-lock.yaml
```

## 2. 登录 Cloudflare

```bash
pnpx wrangler login
pnpx wrangler whoami
```

## 3. 创建 R2 缓存桶

首次部署时执行一次：

```bash
pnpx wrangler r2 bucket create ddplay-api-cache
```

确保 `wrangler.toml` 中的 R2 bucket 名称与这里一致。

## 4. 配置 R2 生命周期

这些规则用于自动清理长期无人再次访问的旧缓存；Worker 本身也会在读取时删除超过 stale 期限的对象。

```bash
pnpx wrangler r2 bucket lifecycle add ddplay-api-cache ddplay-comment-v4 "v4/comment/" --expire-days 120
pnpx wrangler r2 bucket lifecycle add ddplay-api-cache ddplay-search-episodes-v4 "v4/search_episodes/" --expire-days 45
pnpx wrangler r2 bucket lifecycle add ddplay-api-cache ddplay-search-anime-v4 "v4/search_anime/" --expire-days 45
pnpx wrangler r2 bucket lifecycle add ddplay-api-cache ddplay-bangumi-v4 "v4/bangumi/" --expire-days 45
pnpx wrangler r2 bucket lifecycle add ddplay-api-cache ddplay-related-v4 "v4/related/" --expire-days 45
pnpx wrangler r2 bucket lifecycle add ddplay-api-cache ddplay-extcomment-v4 "v4/extcomment/" --expire-days 45
pnpx wrangler r2 bucket lifecycle add ddplay-api-cache ddplay-match-v4 "v4/match/" --expire-days 30
pnpx wrangler r2 bucket lifecycle add ddplay-api-cache ddplay-meta-v4 "v4/meta/episode-air-date/" --expire-days 730
```

检查规则：

```bash
pnpx wrangler r2 bucket lifecycle list ddplay-api-cache
```

## 5. 配置 DanDanPlay 密钥

如果 Worker 已经有一个正常部署版本：

```bash
pnpx wrangler secret put APP_ID
pnpx wrangler secret put APP_SECRET
```

如果是首次部署且 `secret put` 提示“latest version isn't currently deployed”，使用：

```bash
pnpx wrangler versions secret put APP_ID
pnpx wrangler versions secret put APP_SECRET
pnpx wrangler deploy
```

不要把密钥直接写进源码或提交到 Git。

## 6. 本地测试与部署

```bash
pnpx wrangler dev
```

正式部署：

```bash
pnpx wrangler deploy
```

查看实时日志：

```bash
pnpx wrangler tail
```

## 7. 缓存说明

R2 中的大型 JSON 会自动 gzip 压缩，小文件或压缩收益很低的文件保持原样。旧版未压缩对象仍可直接读取，不需要清空 R2。

弹幕 fresh TTL：

```text
当天发布       3h
发布 1~3 天    24h
发布 4 天以上  3d
发布日期未知   3h
```

fresh 过期后不会立即删除；上游 429、5xx 或本地配额耗尽时，可以继续使用 stale 缓存兜底。

原有代理 URL 形式仍可继续使用：

```text
https://你的域名/cors/https://api.dandanplay.net/api/v2/...
```
