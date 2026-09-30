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

## 4. 配置 DanDanPlay 密钥

**首次部署**时使用下面的命令

```bash
cat > secrets.json <<'EOF'
{
  "APP_ID": "你的AppId",
  "APP_SECRET": "你的AppSecret"
}
EOF

pnpx wrangler deploy --secrets-file secrets.json

rm secrets.json
```

分别写入 AppId 和 AppSecret：

```bash
pnpx wrangler secret put APP_ID
pnpx wrangler secret put APP_SECRET
```

按提示输入对应值即可。不要把密钥直接写进源码或提交到 Git。

## 5. 本地测试

```bash
pnpx wrangler dev
```

本地测试通过后按 `Ctrl+C` 退出。

## 6. 部署

```bash
pnpx wrangler deploy
```

以后修改 `ddplay_worker.mjs` 或 `wrangler.toml` 后，重新执行：

```bash
pnpx wrangler deploy
```

即可更新线上 Worker。

## 7. 常用命令

```bash
# 查看 Wrangler 版本
pnpx wrangler -v

# 查看登录状态
pnpx wrangler whoami

# 本地运行
pnpx wrangler dev

# 部署
pnpx wrangler deploy

# 查看实时日志
pnpx wrangler tail
```

部署完成后，原有代理 URL 形式仍可继续使用：

```text
https://你的域名/cors/https://api.dandanplay.net/api/v2/...
```
