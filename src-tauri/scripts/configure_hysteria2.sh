#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-}"
SNI="${2:-www.bing.com}"

if [[ -z "${PORT}" ]]; then
  echo "::error:: missing_argument port required as $1"
  exit 1
fi

if ! [[ "${PORT}" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  echo "::error:: invalid_port port=${PORT}"
  exit 1
fi

CONFIG_FILE="/etc/hysteria/config.yaml"
CONFIG_DIR="/etc/hysteria"
CERT_FILE="/etc/hysteria/server.crt"
KEY_FILE="/etc/hysteria/server.key"

mkdir -p "${CONFIG_DIR}"

if [[ -f "${CONFIG_FILE}" ]]; then
  BACKUP="${CONFIG_FILE}.bak.$(date +%s)"
  cp "${CONFIG_FILE}" "${BACKUP}"
  echo "已备份现有配置到 ${BACKUP}"
fi

echo "正在生成随机密码..."
PASSWORD="$(openssl rand -base64 24)"

echo "正在生成自签名 TLS 证书..."
openssl ecparam -genkey -name prime256v1 -out "${KEY_FILE}"
openssl req -new -x509 -days 3650 -key "${KEY_FILE}" -out "${CERT_FILE}" -subj "/CN=${SNI}"
chmod 600 "${KEY_FILE}"

echo "正在写入 Hysteria2 配置文件..."
cat > "${CONFIG_FILE}" << CFGEOF
listen: :${PORT}
tls:
  cert: /etc/hysteria/server.crt
  key: /etc/hysteria/server.key
auth:
  type: password
  password: "${PASSWORD}"
masquerade:
  type: proxy
  proxy:
    url: https://${SNI}
    rewriteHost: true
CFGEOF
chmod 600 "${CONFIG_FILE}"
chmod 600 "${KEY_FILE}"
chmod 644 "${CERT_FILE}"

echo "正在启用 Hysteria2 开机自启..."
systemctl enable hysteria-server 2>&1 || true

echo "正在重启 Hysteria2 服务以加载新配置..."
if ! systemctl restart hysteria-server 2>&1; then
  echo "::error:: hysteria_service_restart_failed" >&2
  journalctl -u hysteria-server -n 50 --no-pager >&2 || true
  exit 1
fi

sleep 2
if ! systemctl is-active --quiet hysteria-server; then
  echo "::error:: hysteria_service_not_active" >&2
  echo "--- systemctl status ---" >&2
  systemctl status hysteria-server --no-pager -l >&2 || true
  echo "--- journalctl tail ---" >&2
  journalctl -u hysteria-server -n 50 --no-pager >&2 || true
  echo "--- hysteria config ---" >&2
  cat "${CONFIG_FILE}" >&2 || true
  exit 1
fi

echo "验证 Hysteria2 是否在 UDP 端口 ${PORT} 上监听..."
LISTEN_CHECK=""
for _ in 1 2 3 4 5; do
  if command -v ss &>/dev/null; then
    LISTEN_CHECK="$(ss -ulnp 2>/dev/null | grep -E "[:.]${PORT}[[:space:]]" || true)"
  elif command -v netstat &>/dev/null; then
    LISTEN_CHECK="$(netstat -ulnp 2>/dev/null | grep -E "[:.]${PORT}[[:space:]]" || true)"
  fi
  if [[ -n "${LISTEN_CHECK}" ]]; then
    break
  fi
  sleep 1
done

if [[ -z "${LISTEN_CHECK}" ]]; then
  echo "::error:: hysteria_port_not_listening port=${PORT}" >&2
  echo "--- systemctl status ---" >&2
  systemctl status hysteria-server --no-pager -l >&2 || true
  echo "--- journalctl tail ---" >&2
  journalctl -u hysteria-server -n 50 --no-pager >&2 || true
  echo "--- ss -ulnp 实际监听 ---" >&2
  ss -ulnp >&2 2>&1 || netstat -ulnp >&2 2>&1 || true
  echo "--- hysteria config ---" >&2
  cat "${CONFIG_FILE}" >&2 || true
  exit 1
fi
echo "确认监听：${LISTEN_CHECK}"

echo "::result:: password=${PASSWORD}"
echo "::result:: port=${PORT}"
echo "::result:: sni=${SNI}"
echo "::result:: insecure=1"
echo "Hysteria2 配置完成。"
