#!/usr/bin/env bash
# 停止并删除 setup.sh 创建的容器和网络。工作目录（默认 .e2e）保留，可手动删除。
set -uo pipefail

docker rm -f jfdm-jellyfin >/dev/null 2>&1 && echo "已删除容器 jfdm-jellyfin"
docker network rm jfdm-e2e >/dev/null 2>&1 && echo "已删除网络 jfdm-e2e"
echo "工作目录未删除（Jellyfin 以容器内 root 写入的文件可能需要 sudo 或用容器删除）"
