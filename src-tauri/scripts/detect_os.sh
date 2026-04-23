#!/usr/bin/env bash
set -euo pipefail

echo "正在检测操作系统..."

if [[ ! -f /etc/os-release ]]; then
  echo "::error:: unsupported_os no_os_release_file"
  exit 2
fi

# shellcheck source=/dev/null
source /etc/os-release

DISTRO="${ID:-}"
VERSION="${VERSION_ID:-}"
ARCH="$(uname -m)"

echo "检测到系统：${DISTRO} ${VERSION}，架构：${ARCH}"

case "${DISTRO}" in
  debian|ubuntu) ;;
  *)
    echo "::error:: unsupported_os id=${DISTRO}"
    exit 2
    ;;
esac

case "${ARCH}" in
  x86_64|aarch64) ;;
  *)
    echo "::error:: unsupported_arch arch=${ARCH}"
    exit 3
    ;;
esac

echo "::result:: distro=${DISTRO}"
echo "::result:: version=${VERSION}"
echo "::result:: arch=${ARCH}"
echo "操作系统检测完成。"
