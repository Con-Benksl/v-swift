#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-}"
SNI="${2:-www.microsoft.com}"

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

CONFIG_FILE="/usr/local/etc/xray/config.json"
CONFIG_DIR="/usr/local/etc/xray"
MARKER_FILE="/var/lib/v-swift/managed/xray"
if [[ ! -f "${MARKER_FILE}" || -L "${MARKER_FILE}" ]]; then
  echo "::error:: xray_not_owned_by_v_swift" >&2
  echo "缺少 V-Swift 所有权标记，拒绝覆盖 Xray 配置。" >&2
  exit 1
fi
if [[ "$(stat -c %h "${MARKER_FILE}")" != "1" || "$(stat -c %u "${MARKER_FILE}")" != "0" ]] ||
  ! cmp -s "${MARKER_FILE}" <(printf '%s\n' 'managed-by=v-swift'); then
  echo "::error:: xray_not_owned_by_v_swift" >&2
  echo "V-Swift 所有权标记不规范，拒绝覆盖 Xray 配置。" >&2
  exit 1
fi
if [[ -L "${CONFIG_DIR}" || -L "${CONFIG_FILE}" ]]; then
  echo "::error:: unsafe_symlink_detected xray config path" >&2
  exit 1
fi
mkdir -p "${CONFIG_DIR}"

BACKUP=""
CONFIG_TMP=""
HAD_EXISTING_CONFIG=0
CONFIG_TOUCHED=0
WAS_ENABLED=0
WAS_ACTIVE=0
if systemctl is-enabled --quiet xray; then WAS_ENABLED=1; fi
if systemctl is-active --quiet xray; then WAS_ACTIVE=1; fi

rollback_on_error() {
  local exit_code="$?"
  local rollback_failed=0
  local config_restored=1
  trap - EXIT
  [[ -z "${CONFIG_TMP}" || ! -e "${CONFIG_TMP}" ]] || rm -f "${CONFIG_TMP}" || rollback_failed=1
  if (( CONFIG_TOUCHED == 1 )); then
    echo "配置未完成，正在恢复部署前的 Xray 状态..." >&2
    if (( HAD_EXISTING_CONFIG == 1 )) && [[ -n "${BACKUP}" && -f "${BACKUP}" ]]; then
      if mv -f "${BACKUP}" "${CONFIG_FILE}" && chmod 600 "${CONFIG_FILE}"; then
        BACKUP=""
      else
        config_restored=0
        rollback_failed=1
      fi
    else
      rm -f "${CONFIG_FILE}" || { config_restored=0; rollback_failed=1; }
    fi
    if (( config_restored == 1 )); then
      if (( WAS_ENABLED == 1 )); then systemctl enable xray >/dev/null 2>&1 || rollback_failed=1; else systemctl disable xray >/dev/null 2>&1 || rollback_failed=1; fi
      if (( WAS_ACTIVE == 1 )); then systemctl restart xray >/dev/null 2>&1 || rollback_failed=1; else systemctl stop xray >/dev/null 2>&1 || rollback_failed=1; fi
    else
      systemctl stop xray >/dev/null 2>&1 || rollback_failed=1
      systemctl disable xray >/dev/null 2>&1 || rollback_failed=1
    fi
  elif [[ -n "${BACKUP}" && -f "${BACKUP}" ]]; then
    if rm -f "${BACKUP}"; then
      BACKUP=""
    else
      rollback_failed=1
    fi
  fi
  if (( rollback_failed == 1 )); then
    echo "::error:: rollback_incomplete service=xray backup=${BACKUP:-none}" >&2
    echo "自动回滚未完全成功；已尽量停止服务，请核对配置与 systemd 状态。" >&2
  fi
  exit "${exit_code}"
}
trap rollback_on_error EXIT

if [[ -f "${CONFIG_FILE}" ]]; then
  HAD_EXISTING_CONFIG=1
  BACKUP="$(mktemp "${CONFIG_FILE}.bak.XXXXXX")"
  cp "${CONFIG_FILE}" "${BACKUP}"
  echo "已备份现有配置到 ${BACKUP}"
fi

echo "正在生成 Reality 密钥对..."
if ! KEYPAIR="$(/usr/local/bin/xray x25519 2>&1)"; then
  echo "::error:: xray_x25519_failed" >&2
  echo "Xray 密钥生成失败；命令输出可能包含敏感内容，已隐藏。" >&2
  exit 1
fi

PRIVATE_KEY="$(echo "${KEYPAIR}" | awk -F': *' '/[Pp]rivate ?[Kk]ey/{print $2; exit}')"
PUBLIC_KEY="$(echo "${KEYPAIR}" | awk -F': *' '/[Pp]ublic ?[Kk]ey/{print $2; exit}')"

if [[ -z "${PRIVATE_KEY}" || -z "${PUBLIC_KEY}" ]]; then
  echo "::error:: reality_key_parse_failed" >&2
  echo "无法识别 Xray 密钥输出格式；敏感内容已隐藏。" >&2
  exit 1
fi
echo "已解析 PrivateKey 长度=${#PRIVATE_KEY} PublicKey 长度=${#PUBLIC_KEY}"

echo "正在生成 UUID..."
UUID="$(cat /proc/sys/kernel/random/uuid)"

echo "正在生成 Short ID..."
SHORT_ID="$(openssl rand -hex 4)"

echo "正在写入 Xray 配置文件..."
CONFIG_TMP="$(mktemp "${CONFIG_FILE}.tmp.XXXXXX")"
cat > "${CONFIG_TMP}" << CFGEOF
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
chmod 600 "${CONFIG_TMP}"
CONFIG_TOUCHED=1
mv -f "${CONFIG_TMP}" "${CONFIG_FILE}"
CONFIG_TMP=""

echo "正在启用 Xray 开机自启..."
systemctl enable xray 2>&1

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
  echo "Xray 配置包含私钥，诊断输出已省略。" >&2
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
  echo "Xray 配置包含私钥，诊断输出已省略。" >&2
  exit 1
fi
echo "确认监听：${LISTEN_CHECK}"

if [[ -n "${BACKUP}" && -f "${BACKUP}" ]]; then
  rm -f "${BACKUP}"
  BACKUP=""
fi

echo "::result:: uuid=${UUID}"
echo "::result:: public_key=${PUBLIC_KEY}"
echo "::result:: short_id=${SHORT_ID}"
echo "::result:: port=${PORT}"
echo "::result:: sni=${SNI}"
echo "::result:: flow=xtls-rprx-vision"
echo "::result:: spider_x=/"
echo "VLESS-Reality 配置完成。"
trap - EXIT
