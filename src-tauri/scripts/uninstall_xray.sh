#!/usr/bin/env bash
set -euo pipefail

echo "正在停止并禁用 Xray 服务..."
systemctl disable --now xray || true

echo "正在删除 systemd 服务文件..."
unlink /etc/systemd/system/xray.service 2>/dev/null || true

systemctl daemon-reload || true

echo "正在删除 Xray 二进制文件..."
unlink /usr/local/bin/xray 2>/dev/null || true

echo "正在删除 Xray 配置目录..."
find /usr/local/etc/xray -mindepth 1 -delete 2>/dev/null || true
rmdir /usr/local/etc/xray 2>/dev/null || true

echo "::info:: firewall rules not removed"
echo "Xray 卸载完成。"
