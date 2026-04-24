#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-}"
SNI="${2:-www.microsoft.com}"

if [[ -z "${PORT}" ]]; then
  echo "::error:: missing_argument port required as $1"
  exit 1
fi

if ! [[ "${PORT}" =~ ^[0-9]+$ ]] || (( PORT < 1024 || PORT > 65535 )); then
  echo "::error:: invalid_port port=${PORT}"
  exit 1
fi

if ! [[ "${SNI}" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$ ]]; then
  echo "::error:: invalid_sni sni=${SNI}"
  exit 1
fi

CONFIG_FILE="/usr/local/etc/xray/config.json"
CONFIG_DIR="/usr/local/etc/xray"
mkdir -p "${CONFIG_DIR}"

if [[ -f "${CONFIG_FILE}" ]]; then
  BACKUP="${CONFIG_FILE}.bak.$(date +%s)"
  cp "${CONFIG_FILE}" "${BACKUP}"
  echo "已备份现有配置到 ${BACKUP}"
fi

echo "正在生成 Reality 密钥对..."
if ! KEYPAIR="$(/usr/local/bin/xray x25519 2>&1)"; then
  echo "::error:: xray_x25519_failed" >&2
  echo "${KEYPAIR}" >&2
  exit 1
fi
echo "${KEYPAIR}"

PRIVATE_KEY="$(echo "${KEYPAIR}" | awk -F': *' '/[Pp]rivate ?[Kk]ey/{print $2; exit}')"
PUBLIC_KEY="$(echo "${KEYPAIR}" | awk -F': *' '/[Pp]ublic ?[Kk]ey/{print $2; exit}')"

if [[ -z "${PRIVATE_KEY}" || -z "${PUBLIC_KEY}" ]]; then
  echo "::error:: reality_key_parse_failed" >&2
  echo "Got KEYPAIR output:" >&2
  echo "${KEYPAIR}" >&2
  exit 1
fi
echo "已解析 PrivateKey 长度=${#PRIVATE_KEY} PublicKey 长度=${#PUBLIC_KEY}"

echo "正在生成 UUID..."
UUID="$(cat /proc/sys/kernel/random/uuid)"

echo "正在生成 Short ID..."
SHORT_ID="$(openssl rand -hex 4)"

echo "正在写入 Xray 配置文件..."
cat > "${CONFIG_FILE}" << CFGEOF
{
  "log": {"loglevel": "warning"},
  "inbounds": [{
    "port": ${PORT},
    "protocol": "vless",
    "settings": {
      "clients": [{"id": "${UUID}", "flow": "xtls-rprx-vision"}],
      "decryption": "none"
    },
    "streamSettings": {
      "network": "tcp",
      "security": "reality",
      "realitySettings": {
        "dest": "${SNI}:443",
        "serverNames": ["${SNI}"],
        "privateKey": "${PRIVATE_KEY}",
        "shortIds": ["${SHORT_ID}"]
      }
    }
  }],
  "outbounds": [{"protocol": "freedom"}]
}
CFGEOF
chmod 600 "${CONFIG_FILE}"

echo "正在启用 Xray 开机自启..."
systemctl enable xray 2>&1 || true

echo "正在重启 Xray 服务以加载新配置..."
if ! systemctl restart xray 2>&1; then
  echo "::error:: xray_service_restart_failed" >&2
  journalctl -u xray -n 50 --no-pager >&2 || true
  exit 1
fi

sleep 2
if ! systemctl is-active --quiet xray; then
  echo "::error:: xray_service_not_active" >&2
  echo "--- systemctl status ---" >&2
  systemctl status xray --no-pager -l >&2 || true
  echo "--- journalctl tail ---" >&2
  journalctl -u xray -n 50 --no-pager >&2 || true
  echo "--- xray config ---" >&2
  cat "${CONFIG_FILE}" >&2 || true
  exit 1
fi

echo "验证 Xray 是否在端口 ${PORT} 上监听..."
LISTEN_CHECK=""
for _ in 1 2 3 4 5; do
  if command -v ss &>/dev/null; then
    LISTEN_CHECK="$(ss -tlnp 2>/dev/null | grep -E "[:.]${PORT}[[:space:]]" || true)"
  elif command -v netstat &>/dev/null; then
    LISTEN_CHECK="$(netstat -tlnp 2>/dev/null | grep -E "[:.]${PORT}[[:space:]]" || true)"
  fi
  if [[ -n "${LISTEN_CHECK}" ]]; then
    break
  fi
  sleep 1
done

if [[ -z "${LISTEN_CHECK}" ]]; then
  echo "::error:: xray_port_not_listening port=${PORT}" >&2
  echo "--- systemctl status ---" >&2
  systemctl status xray --no-pager -l >&2 || true
  echo "--- journalctl tail ---" >&2
  journalctl -u xray -n 50 --no-pager >&2 || true
  echo "--- ss -tlnp 实际监听 ---" >&2
  ss -tlnp >&2 2>&1 || netstat -tlnp >&2 2>&1 || true
  echo "--- xray config ---" >&2
  cat "${CONFIG_FILE}" >&2 || true
  exit 1
fi
echo "确认监听：${LISTEN_CHECK}"

echo "::result:: uuid=${UUID}"
echo "::result:: public_key=${PUBLIC_KEY}"
echo "::result:: short_id=${SHORT_ID}"
echo "::result:: port=${PORT}"
echo "::result:: sni=${SNI}"
echo "::result:: flow=xtls-rprx-vision"
echo "::result:: spider_x=/"
echo "VLESS-Reality 配置完成。"
