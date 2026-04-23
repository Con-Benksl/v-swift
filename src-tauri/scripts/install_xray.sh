#!/usr/bin/env bash
set -euo pipefail

ARCH="${1:-}"
if [[ -z "${ARCH}" ]]; then
  echo "::error:: missing_argument arch required as $1"
  exit 1
fi

case "${ARCH}" in
  x86_64)   ASSET="Xray-linux-64.zip" ;;
  aarch64)  ASSET="Xray-linux-arm64-v8a.zip" ;;
  *)
    echo "::error:: unsupported_arch arch=${ARCH}"
    exit 1
    ;;
esac

DOWNLOAD_URL="https://github.com/XTLS/Xray-core/releases/latest/download/${ASSET}"
INSTALL_BIN="/usr/local/bin/xray"
CONFIG_DIR="/usr/local/etc/xray"
SERVICE_FILE="/etc/systemd/system/xray.service"

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
  echo "Xray 已安装，跳过下载。"
else
  echo "正在下载 Xray (${ASSET}) 来自 ${DOWNLOAD_URL}"
  TMP_DIR="$(mktemp -d)"
  DOWNLOADED=false
  for attempt in 1 2 3; do
    echo "下载尝试 ${attempt}/3..."
    if download_with_heartbeat "${DOWNLOAD_URL}" "${TMP_DIR}/${ASSET}"; then
      DOWNLOADED=true
      break
    fi
    echo "下载失败，等待 3 秒后重试..."
    rm -f "${TMP_DIR}/${ASSET}"
    sleep 3
  done

  if [[ "${DOWNLOADED}" != "true" ]]; then
    echo "::error:: download_failed url=${DOWNLOAD_URL}"
    exit 1
  fi

  echo "下载完成，正在解压 Xray..."
  unzip -o "${TMP_DIR}/${ASSET}" xray -d "${TMP_DIR}/"
  install -m 755 "${TMP_DIR}/xray" "${INSTALL_BIN}"
  echo "Xray 二进制文件已安装到 ${INSTALL_BIN}。"
fi

echo "正在创建配置目录..."
mkdir -p "${CONFIG_DIR}"

echo "正在写入 systemd 服务文件..."
cat > "${SERVICE_FILE}" << 'SVCEOF'
[Unit]
Description=Xray Service
Documentation=https://github.com/xtls
After=network.target nss-lookup.target

[Service]
User=root
ExecStart=/usr/local/bin/xray run -config /usr/local/etc/xray/config.json
Restart=on-failure
RestartSec=5s
LimitNPROC=10000
LimitNOFILE=1000000

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
echo "Xray 安装完成（未启动，等待配置）。"
