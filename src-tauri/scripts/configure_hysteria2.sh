#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-}"
SNI="${2:-www.bing.com}"

if [[ -z "${PORT}" ]]; then
  echo "::error:: missing_argument port required as argument 1"
  exit 1
fi

if ! [[ "${PORT}" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  echo "::error:: invalid_port port=${PORT}"
  exit 1
fi

if ! [[ "${SNI}" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$ ]]; then
  echo "::error:: invalid_sni sni=${SNI}"
  exit 1
fi

umask 077

CONFIG_FILE="/etc/hysteria/config.yaml"
CONFIG_DIR="/etc/hysteria"
CERT_FILE="/etc/hysteria/server.crt"
KEY_FILE="/etc/hysteria/server.key"
MARKER_FILE="/var/lib/v-swift/managed/hysteria2"

if [[ ! -f "${MARKER_FILE}" || -L "${MARKER_FILE}" ]]; then
  echo "::error:: hysteria2_not_owned_by_v_swift" >&2
  echo "缺少 V-Swift 所有权标记，拒绝覆盖 Hysteria2 配置。" >&2
  exit 1
fi
if [[ "$(stat -c %h "${MARKER_FILE}")" != "1" || "$(stat -c %u "${MARKER_FILE}")" != "0" ]] ||
  ! cmp -s "${MARKER_FILE}" <(printf '%s\n' 'managed-by=v-swift'); then
  echo "::error:: hysteria2_not_owned_by_v_swift" >&2
  echo "V-Swift 所有权标记不规范，拒绝覆盖 Hysteria2 配置。" >&2
  exit 1
fi
if [[ -L "${CONFIG_DIR}" || -L "${CONFIG_FILE}" || -L "${CERT_FILE}" || -L "${KEY_FILE}" ]]; then
  echo "::error:: unsafe_symlink_detected hysteria2 config path" >&2
  exit 1
fi

mkdir -p "${CONFIG_DIR}"

CONFIG_BACKUP=""
CERT_BACKUP=""
KEY_BACKUP=""
CONFIG_TMP=""
CERT_TMP=""
KEY_TMP=""
HAD_CONFIG=0
HAD_CERT=0
HAD_KEY=0
FILES_TOUCHED=0
WAS_ENABLED=0
WAS_ACTIVE=0
if systemctl is-enabled --quiet hysteria-server; then WAS_ENABLED=1; fi
if systemctl is-active --quiet hysteria-server; then WAS_ACTIVE=1; fi

rollback_on_error() {
  local exit_code="$?"
  local rollback_failed=0
  local files_restored=1
  trap - EXIT
  [[ -z "${CONFIG_TMP}" || ! -e "${CONFIG_TMP}" ]] || rm -f "${CONFIG_TMP}" || rollback_failed=1
  [[ -z "${CERT_TMP}" || ! -e "${CERT_TMP}" ]] || rm -f "${CERT_TMP}" || rollback_failed=1
  [[ -z "${KEY_TMP}" || ! -e "${KEY_TMP}" ]] || rm -f "${KEY_TMP}" || rollback_failed=1
  if (( FILES_TOUCHED == 1 )); then
    echo "配置未完成，正在恢复部署前的 Hysteria2 状态..." >&2
    if (( HAD_CONFIG == 1 )); then
      if [[ -f "${CONFIG_BACKUP}" ]] && mv -f "${CONFIG_BACKUP}" "${CONFIG_FILE}" && chmod 600 "${CONFIG_FILE}"; then CONFIG_BACKUP=""; else files_restored=0; rollback_failed=1; fi
    else
      rm -f "${CONFIG_FILE}" || { files_restored=0; rollback_failed=1; }
    fi
    if (( HAD_CERT == 1 )); then
      if [[ -f "${CERT_BACKUP}" ]] && mv -f "${CERT_BACKUP}" "${CERT_FILE}" && chmod 644 "${CERT_FILE}"; then CERT_BACKUP=""; else files_restored=0; rollback_failed=1; fi
    else
      rm -f "${CERT_FILE}" || { files_restored=0; rollback_failed=1; }
    fi
    if (( HAD_KEY == 1 )); then
      if [[ -f "${KEY_BACKUP}" ]] && mv -f "${KEY_BACKUP}" "${KEY_FILE}" && chmod 600 "${KEY_FILE}"; then KEY_BACKUP=""; else files_restored=0; rollback_failed=1; fi
    else
      rm -f "${KEY_FILE}" || { files_restored=0; rollback_failed=1; }
    fi
    if (( files_restored == 1 )); then
      if (( WAS_ENABLED == 1 )); then systemctl enable hysteria-server >/dev/null 2>&1 || rollback_failed=1; else systemctl disable hysteria-server >/dev/null 2>&1 || rollback_failed=1; fi
      if (( WAS_ACTIVE == 1 )); then systemctl restart hysteria-server >/dev/null 2>&1 || rollback_failed=1; else systemctl stop hysteria-server >/dev/null 2>&1 || rollback_failed=1; fi
    else
      systemctl stop hysteria-server >/dev/null 2>&1 || rollback_failed=1
      systemctl disable hysteria-server >/dev/null 2>&1 || rollback_failed=1
    fi
  else
    if [[ -n "${CONFIG_BACKUP}" && -f "${CONFIG_BACKUP}" ]]; then
      if rm -f "${CONFIG_BACKUP}"; then CONFIG_BACKUP=""; else rollback_failed=1; fi
    fi
    if [[ -n "${CERT_BACKUP}" && -f "${CERT_BACKUP}" ]]; then
      if rm -f "${CERT_BACKUP}"; then CERT_BACKUP=""; else rollback_failed=1; fi
    fi
    if [[ -n "${KEY_BACKUP}" && -f "${KEY_BACKUP}" ]]; then
      if rm -f "${KEY_BACKUP}"; then KEY_BACKUP=""; else rollback_failed=1; fi
    fi
  fi
  if (( rollback_failed == 1 )); then
    echo "::error:: rollback_incomplete service=hysteria2 config_backup=${CONFIG_BACKUP:-none} cert_backup=${CERT_BACKUP:-none} key_backup=${KEY_BACKUP:-none}" >&2
    echo "自动回滚未完全成功；已尽量停止服务，请核对配置、证书与 systemd 状态。" >&2
  fi
  exit "${exit_code}"
}
trap rollback_on_error EXIT

if [[ -f "${CONFIG_FILE}" ]]; then
  HAD_CONFIG=1
  CONFIG_BACKUP="$(mktemp "${CONFIG_FILE}.bak.XXXXXX")"
  cp "${CONFIG_FILE}" "${CONFIG_BACKUP}"
  echo "已备份现有配置到 ${CONFIG_BACKUP}"
fi
if [[ -f "${CERT_FILE}" ]]; then
  HAD_CERT=1
  CERT_BACKUP="$(mktemp "${CERT_FILE}.bak.XXXXXX")"
  cp "${CERT_FILE}" "${CERT_BACKUP}"
fi
if [[ -f "${KEY_FILE}" ]]; then
  HAD_KEY=1
  KEY_BACKUP="$(mktemp "${KEY_FILE}.bak.XXXXXX")"
  cp "${KEY_FILE}" "${KEY_BACKUP}"
fi

echo "正在生成随机密码..."
PASSWORD="$(openssl rand -base64 24)"

echo "正在生成自签名 TLS 证书..."
KEY_TMP="$(mktemp "${KEY_FILE}.tmp.XXXXXX")"
CERT_TMP="$(mktemp "${CERT_FILE}.tmp.XXXXXX")"
openssl ecparam -genkey -name prime256v1 -out "${KEY_TMP}"
openssl req -new -x509 -days 3650 -key "${KEY_TMP}" -out "${CERT_TMP}" -subj "/CN=${SNI}"
chmod 600 "${KEY_TMP}"
chmod 644 "${CERT_TMP}"

echo "正在写入 Hysteria2 配置文件..."
CONFIG_TMP="$(mktemp "${CONFIG_FILE}.tmp.XXXXXX")"
cat > "${CONFIG_TMP}" << CFGEOF
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
chmod 600 "${CONFIG_TMP}"
FILES_TOUCHED=1
mv -f "${KEY_TMP}" "${KEY_FILE}"
KEY_TMP=""
mv -f "${CERT_TMP}" "${CERT_FILE}"
CERT_TMP=""
mv -f "${CONFIG_TMP}" "${CONFIG_FILE}"
CONFIG_TMP=""

echo "正在启用 Hysteria2 开机自启..."
systemctl enable hysteria-server 2>&1

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
  echo "Hysteria2 配置包含密码，诊断输出已省略。" >&2
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
  echo "Hysteria2 配置包含密码，诊断输出已省略。" >&2
  exit 1
fi
echo "确认监听：${LISTEN_CHECK}"

trap - EXIT
for backup in "${CONFIG_BACKUP}" "${CERT_BACKUP}" "${KEY_BACKUP}"; do
  if [[ -n "${backup}" && -f "${backup}" ]] && ! rm -f "${backup}"; then
    echo "::warning:: sensitive_backup_cleanup_failed path=${backup}" >&2
  fi
done
CONFIG_BACKUP=""
CERT_BACKUP=""
KEY_BACKUP=""

echo "::result:: password=${PASSWORD}"
echo "::result:: port=${PORT}"
echo "::result:: sni=${SNI}"
echo "::result:: insecure=1"
echo "Hysteria2 配置完成。"
