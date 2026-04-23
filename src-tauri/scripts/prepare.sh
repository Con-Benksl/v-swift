#!/usr/bin/env bash
set -euo pipefail

echo "正在更新软件包列表..."
if ! apt-get update -yq 2>&1; then
  echo "警告：apt-get update 部分仓库失败（通常是 backports/第三方源 404），继续尝试安装核心依赖。"
fi

echo "正在安装必要依赖..."
apt-get install -yq curl ca-certificates tar unzip jq openssl

echo "依赖安装完成。"
