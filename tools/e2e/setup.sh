#!/usr/bin/env bash
# 启动一个临时 Jellyfin（默认最新版），生成测试剧集并完成初始化向导。
# 用法：tools/e2e/setup.sh [工作目录，默认 .e2e] ；环境变量 JELLYFIN_IMAGE 可指定镜像（如 jellyfin/jellyfin:10.10.7）
set -euo pipefail

WORK="$(realpath -m "${1:-.e2e}")"
IMAGE="${JELLYFIN_IMAGE:-jellyfin/jellyfin:latest}"
NETWORK=jfdm-e2e
CONTAINER=jfdm-jellyfin
PORT="${E2E_PORT:-18096}"
SERIES="葬送的芙莉莲"
J="http://127.0.0.1:${PORT}"

mkdir -p "$WORK/config" "$WORK/cache" "$WORK/media/$SERIES/Season 1"

docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK" >/dev/null
if ! docker container inspect "$CONTAINER" >/dev/null 2>&1; then
    docker run -d --name "$CONTAINER" --network "$NETWORK" --user "$(id -u):$(id -g)" \
        -p "127.0.0.1:${PORT}:8096" \
        -v "$WORK/config:/config" -v "$WORK/cache:/cache" -v "$WORK/media:/media:ro" \
        "$IMAGE" >/dev/null
fi

echo "等待 Jellyfin 启动…"
for _ in $(seq 1 90); do
    curl -sf "$J/System/Info/Public" >/dev/null && break
    sleep 2
done
curl -s "$J/System/Info/Public"; echo

# 注：Jellyfin 返回的 JSON 字段大小写（PascalCase/camelCase）不固定，下面的解析都兼容两种写法。

# Playwright 自带的 Chromium 没有 H.264/AAC 解码器，测试片源用 VP9/Opus WebM
EPISODE_FILE="$WORK/media/$SERIES/Season 1/$SERIES S01E01.webm"
if [ ! -f "$EPISODE_FILE" ]; then
    docker exec "$CONTAINER" /usr/lib/jellyfin-ffmpeg/ffmpeg -hide_banner -loglevel error \
        -f lavfi -i "testsrc2=size=1280x720:rate=24" -f lavfi -i "sine=frequency=440" -t 90 \
        -c:v libvpx-vp9 -deadline realtime -cpu-used 8 -b:v 1M -c:a libopus -shortest -y /cache/e2e-episode.webm
    cp "$WORK/cache/e2e-episode.webm" "$EPISODE_FILE"
fi

H='Content-Type: application/json'
AUTH='MediaBrowser Client="e2e", Device="cli", DeviceId="e2e-cli", Version="1.0"'
if curl -s "$J/System/Info/Public" | grep -qi '"startupWizardCompleted":false'; then
    curl -sf -X POST "$J/Startup/Configuration" -H "$H" -d '{"UICulture":"zh-CN","MetadataCountryCode":"CN","PreferredMetadataLanguage":"zh"}'
    curl -sf "$J/Startup/User" >/dev/null
    curl -sf -X POST "$J/Startup/User" -H "$H" -d '{"Name":"test","Password":"test"}'
    curl -sf -X POST "$J/Startup/RemoteAccess" -H "$H" -d '{"EnableRemoteAccess":true,"EnableAutomaticPortMapping":false}'
    curl -sf -X POST "$J/Startup/Complete"
fi

TOKEN=$(curl -sf -X POST "$J/Users/AuthenticateByName" -H "$H" -H "Authorization: $AUTH" -d '{"Username":"test","Pw":"test"}' |
    python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("AccessToken") or d.get("accessToken"))')
AUTHT="$AUTH, Token=\"$TOKEN\""

if ! curl -sf "$J/Library/VirtualFolders" -H "Authorization: $AUTHT" | grep -qi '"Name":"Anime"'; then
    # 关闭元数据下载器，剧集信息只来自文件夹/文件名，测试结果稳定
    curl -sf -X POST "$J/Library/VirtualFolders?name=Anime&collectionType=tvshows&refreshLibrary=true" -H "$H" -H "Authorization: $AUTHT" \
        -d '{"LibraryOptions":{"PathInfos":[{"Path":"/media"}],"EnableRealtimeMonitor":false,"TypeOptions":[{"Type":"Series","MetadataFetchers":[],"ImageFetchers":[]},{"Type":"Season","MetadataFetchers":[],"ImageFetchers":[]},{"Type":"Episode","MetadataFetchers":[],"ImageFetchers":[]}]}}'
fi

echo "等待媒体库扫描…"
# 建库时附带的首次扫描可能早于目录注册完成而扫不到文件，主动触发刷新并在轮询中定期重试
EPISODE_ID=""
for i in $(seq 1 30); do
    if [ $((i % 5)) -eq 1 ]; then
        curl -sf -X POST "$J/Library/Refresh" -H "Authorization: $AUTHT" || true
    fi
    EPISODE_ID=$(curl -sf "$J/Items?Recursive=true&IncludeItemTypes=Episode" -H "Authorization: $AUTHT" |
        python3 -c 'import sys,json;d=json.load(sys.stdin);items=d.get("Items") or d.get("items") or [];print((items[0].get("Id") or items[0].get("id")) if items else "")')
    [ -n "$EPISODE_ID" ] && break
    sleep 2
done
[ -n "$EPISODE_ID" ] || { echo "媒体库中没有找到剧集" >&2; exit 1; }

echo "$EPISODE_ID" > "$WORK/episode-id"
echo "就绪：$J  用户 test/test  剧集 $EPISODE_ID"
