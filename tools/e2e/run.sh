#!/usr/bin/env bash
# 用 Playwright 容器（自带 Chromium 与依赖）对 setup.sh 启动的 Jellyfin 截图。
# 用法：tools/e2e/run.sh [工作目录，默认 .e2e]
# 环境变量：MOCK=1、THEME=light、TAG=xxx（见 shot.mjs）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(realpath -m "${1:-$ROOT/.e2e}")"
PLAYWRIGHT_VERSION=1.49.1
IMAGE="mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble"

[ -f "$WORK/episode-id" ] || { echo "请先运行 tools/e2e/setup.sh" >&2; exit 1; }
[ -f "$ROOT/dist/jellyfin-danmaku.user.js" ] || (cd "$ROOT" && npm run build:userscript)

cp "${SHOT_SCRIPT:-$ROOT/tools/e2e/shot.mjs}" "$WORK/shot.mjs"
docker run --rm --network jfdm-e2e --user "$(id -u):$(id -g)" -e HOME=/work \
    -e EPISODE_ID="$(cat "$WORK/episode-id")" -e MOCK="${MOCK:-}" -e THEME="${THEME:-}" -e TAG="${TAG:-}" \
    -v "$WORK:/work" -v "$ROOT/dist:/dist:ro" -w /work "$IMAGE" \
    sh -c "test -d node_modules/playwright || npm i --silent --no-save playwright@${PLAYWRIGHT_VERSION} >/dev/null 2>&1; node shot.mjs"

echo "截图：$WORK/shots"
