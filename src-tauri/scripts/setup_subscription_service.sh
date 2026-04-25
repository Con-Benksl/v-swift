#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="/opt/vps-subscription"

if ! command -v apt-get >/dev/null 2>&1; then
  echo "::error:: unsupported_os apt-get required"
  exit 1
fi

echo "正在更新软件包列表..."
if ! apt-get update -yq 2>&1; then
  echo "警告：apt-get update 部分仓库失败，继续尝试安装订阅服务依赖。"
fi

echo "正在安装订阅服务依赖..."
DEBIAN_FRONTEND=noninteractive apt-get install -yq python3 vnstat curl iproute2

echo "正在创建订阅服务目录..."
install -d -m 755 "${INSTALL_DIR}"

echo "正在启用 vnStat..."
if command -v systemctl >/dev/null 2>&1; then
  systemctl enable --now vnstat >/dev/null 2>&1 || \
    echo "警告：vnstat 服务启用失败，订阅流量统计将暂时返回 0。"
else
  echo "警告：未检测到 systemctl，跳过 vnstat 服务启用。"
fi

IFACE="$(ip route show default 2>/dev/null | awk '{print $5; exit}')"
IFACE="${IFACE:-eth0}"

echo "::result:: iface=${IFACE}"
