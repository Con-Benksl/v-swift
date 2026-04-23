#!/usr/bin/env bash
set -euo pipefail

echo "正在停止并禁用 Hysteria2 服务..."
systemctl disable --now hysteria-server || true

echo "正在删除 systemd 服务文件..."
unlink /etc/systemd/system/hysteria-server.service 2>/dev/null || true

systemctl daemon-reload || true

echo "正在删除 Hysteria2 二进制文件..."
unlink /usr/local/bin/hysteria 2>/dev/null || true

echo "正在删除 Hysteria2 配置目录..."
find /etc/hysteria -mindepth 1 -delete 2>/dev/null || true
rmdir /etc/hysteria 2>/dev/null || true

echo "::info:: firewall rules not removed"
echo "Hysteria2 卸载完成。"
