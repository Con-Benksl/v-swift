#!/usr/bin/env bash
set -euo pipefail

ARCH="${1:-}"
if [[ -z "${ARCH}" ]]; then
  echo "::error:: missing_argument arch required as $1"
  exit 1
fi

case "${ARCH}" in
  x86_64)   HY2_ARCH="amd64" ;;
  aarch64)  HY2_ARCH="arm64" ;;
  *)
    echo "::error:: unsupported_arch arch=${ARCH}"
    exit 1
    ;;
esac

DOWNLOAD_URL="https://github.com/apernet/hysteria/releases/latest/download/hysteria-linux-${HY2_ARCH}"
INSTALL_BIN="/usr/local/bin/hysteria"
CONFIG_DIR="/etc/hysteria"
SERVICE_FILE="/etc/systemd/system/hysteria-server.service"

download_with_heartbeat() {
  local url="$1" out="$2"
  curl -fSL --retry 0 --connect-timeout 15 --max-time 600 -o "${out}" "${url}" >/dev/null 2>&1 &
  local pid=$!
  local last_size=0
  while kill -0 "${pid}" 2>/dev/null; do
    sleep 2
    if [[ -f "${out}" ]]; then
      local size human
      size=$(stat -c%s "${out}" 2>/dev/null || echo 0)
      human=$(numfmt --to=iec --suffix=B "${size}" 2>/dev/null || echo "${size}B")
      if (( size != last_size )); then
        echo "  下载中... 已接收 ${human}"
        last_size=$size
      else
        echo "  下载中... 等待数据 (${human})"
      fi
    else
      echo "  下载中... 建立连接"
    fi
  done
  wait "${pid}"
}

if [[ -x "${INSTALL_BIN}" ]]; then
  echo "Hysteria2 已安装，跳过下载。"
else
  echo "正在下载 Hysteria2 (${HY2_ARCH}) 来自 ${DOWNLOAD_URL}"
  TMP_FILE="$(mktemp)"
  DOWNLOADED=false
  RETRY_DELAYS=(3 10 30)
  for attempt in 1 2 3; do
    echo "下载尝试 ${attempt}/3..."
    if download_with_heartbeat "${DOWNLOAD_URL}" "${TMP_FILE}"; then
      DOWNLOADED=true
      break
    fi
    if [[ ${attempt} -lt 3 ]]; then
      delay="${RETRY_DELAYS[$((attempt - 1))]}"
      echo "下载失败，等待 ${delay} 秒后重试..."
      rm -f "${TMP_FILE}"
      sleep "${delay}"
    fi
  done

  if [[ "${DOWNLOADED}" != "true" ]]; then
    echo "::error:: download_failed url=${DOWNLOAD_URL}"
    exit 1
  fi

  install -m 755 "${TMP_FILE}" "${INSTALL_BIN}"
  echo "Hysteria2 二进制文件已安装到 ${INSTALL_BIN}。"
fi

mkdir -p "${CONFIG_DIR}"

echo "正在写入 systemd 服务文件..."
cat > "${SERVICE_FILE}" << 'SVCEOF'
[Unit]
Description=Hysteria Server Service
After=network.target

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/hysteria server -c /etc/hysteria/config.yaml
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
echo "Hysteria2 安装完成（未启动，等待配置）。"
