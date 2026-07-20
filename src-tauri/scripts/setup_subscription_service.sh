#!/usr/bin/env bash
set -euo pipefail

LEGACY_TOKEN_HASH="${1:-}"
EXPECTED_SERVER_HASHES="${2:-}"
INSTALL_DIR="/opt/vps-subscription"
SERVER_FILE="${INSTALL_DIR}/subscription_server.py"
CONFIG_FILE="${INSTALL_DIR}/config.yaml"
RUNTIME_ENV_FILE="${INSTALL_DIR}/runtime.env"
SERVICE_FILE="/etc/systemd/system/vps-subscription.service"
MARKER_DIR="/var/lib/v-swift/managed"
MARKER_FILE="${MARKER_DIR}/subscription"
MARKER_TMP=""

umask 077

cleanup_marker_tmp() {
  [[ -z "${MARKER_TMP}" || ! -e "${MARKER_TMP}" ]] || rm -f "${MARKER_TMP}"
}
trap cleanup_marker_tmp EXIT

expected_marker() {
  cat << 'MARKEREOF'
managed-by=v-swift
resource=vps-subscription
schema=1
MARKEREOF
}

marker_is_valid() {
  [[ -f "${MARKER_FILE}" && ! -L "${MARKER_FILE}" && "$(stat -c %h "${MARKER_FILE}")" == "1" && "$(stat -c %u "${MARKER_FILE}")" == "0" ]] &&
    cmp -s "${MARKER_FILE}" <(expected_marker)
}

expected_current_unit() {
  cat << 'UNITEOF'
[Unit]
Description=V-Swift managed Clash/Mihomo subscription
After=network-online.target vnstat.service
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/opt/vps-subscription/runtime.env
ExecStart=/usr/bin/python3 /opt/vps-subscription/subscription_server.py
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
UNITEOF
}

expected_legacy_unit() {
  local port="$1" iface="$2" token="$3"
  cat << UNITEOF
[Unit]
Description=V-Swift managed Clash/Mihomo subscription
After=network-online.target vnstat.service
Wants=network-online.target

[Service]
Type=simple
Environment=SUB_HOST=0.0.0.0
Environment=SUB_PORT=${port}
Environment=SUB_IFACE=${iface}
Environment=SUB_CONFIG_PATH=/opt/vps-subscription/config.yaml
Environment=SUB_TOTAL_BYTES=3000000000000
Environment=SUB_EXPIRE_TS=1779638400
Environment=SUB_TOKEN=${token}
ExecStart=/usr/bin/python3 /opt/vps-subscription/subscription_server.py
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
UNITEOF
}

current_unit_matches() {
  [[ -f "${SERVICE_FILE}" && ! -L "${SERVICE_FILE}" ]] &&
    cmp -s "${SERVICE_FILE}" <(expected_current_unit)
}

legacy_unit_matches() {
  [[ -f "${SERVICE_FILE}" && ! -L "${SERVICE_FILE}" ]] || return 1
  local port iface token
  port="$(sed -n 's/^Environment=SUB_PORT=//p' "${SERVICE_FILE}" | head -n 1)"
  iface="$(sed -n 's/^Environment=SUB_IFACE=//p' "${SERVICE_FILE}" | head -n 1)"
  token="$(sed -n 's/^Environment=SUB_TOKEN=//p' "${SERVICE_FILE}" | head -n 1)"
  [[ "${port}" == "18080" ]] || return 1
  [[ "${iface}" =~ ^[A-Za-z0-9_.:-]+$ ]] || return 1
  [[ "${token}" =~ ^[0-9a-f]{32}$ ]] || return 1
  cmp -s "${SERVICE_FILE}" <(expected_legacy_unit "${port}" "${iface}" "${token}")
}

has_on_disk_dropins() {
  local root dropin_dir
  for root in /etc/systemd/system /run/systemd/system /usr/local/lib/systemd/system /usr/lib/systemd/system /lib/systemd/system; do
    for dropin_dir in "${root}/vps-subscription.service.d" "${root}/vps-.service.d" "${root}/service.d"; do
      if [[ -L "${dropin_dir}" ]] || { [[ -d "${dropin_dir}" ]] && [[ -n "$(find "${dropin_dir}" -mindepth 1 -maxdepth 1 -name '*.conf' \( -type f -o -type l \) -print -quit 2>/dev/null)" ]]; }; then
        return 0
      fi
    done
  done
  return 1
}

find_shadowed_unit() {
  local candidate
  for candidate in \
    /etc/systemd/system.control/vps-subscription.service \
    /run/systemd/system.control/vps-subscription.service \
    /run/systemd/transient/vps-subscription.service \
    /run/systemd/generator.early/vps-subscription.service \
    /etc/systemd/system.attached/vps-subscription.service \
    /run/systemd/system/vps-subscription.service \
    /run/systemd/system.attached/vps-subscription.service \
    /run/systemd/generator/vps-subscription.service \
    /usr/local/lib/systemd/system/vps-subscription.service \
    /usr/lib/systemd/system/vps-subscription.service \
    /lib/systemd/system/vps-subscription.service \
    /run/systemd/generator.late/vps-subscription.service; do
    if [[ -e "${candidate}" || -L "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done
  return 1
}

effective_fragment_is_safe() {
  local fragment load_state active_state
  fragment="$(systemctl show -p FragmentPath --value vps-subscription.service 2>/dev/null || true)"
  load_state="$(systemctl show -p LoadState --value vps-subscription.service 2>/dev/null || true)"
  active_state="$(systemctl show -p ActiveState --value vps-subscription.service 2>/dev/null || true)"
  if [[ -z "${load_state}" || "${load_state}" == "not-found" ]]; then
    [[ -z "${active_state}" || "${active_state}" == "inactive" || "${active_state}" == "failed" ]] && ! systemctl is-enabled --quiet vps-subscription.service
    return
  fi
  [[ "${fragment}" == "${SERVICE_FILE}" ]]
}

safe_regular_file() {
  local path="$1"
  [[ ! -e "${path}" ]] && return 0
  [[ -f "${path}" && ! -L "${path}" && "$(stat -c %h "${path}")" == "1" && "$(stat -c %u "${path}")" == "0" ]]
}

legacy_assets_match() {
  [[ -n "${LEGACY_TOKEN_HASH}" && -n "${EXPECTED_SERVER_HASHES}" ]] || return 1
  legacy_unit_matches || return 1
  [[ -f "${SERVER_FILE}" && -f "${CONFIG_FILE}" ]] || return 1
  local token current_hash server_hash
  token="$(sed -n 's/^Environment=SUB_TOKEN=//p' "${SERVICE_FILE}" | head -n 1)"
  [[ -n "${token}" ]] || return 1
  current_hash="$(printf '%s' "${token}" | sha256sum | awk '{print $1}')"
  server_hash="$(sha256sum "${SERVER_FILE}" | awk '{print $1}')"
  [[ "${current_hash}" == "${LEGACY_TOKEN_HASH}" ]] && [[ ",${EXPECTED_SERVER_HASHES}," == *",${server_hash},"* ]]
}

if [[ -L "${MARKER_DIR}" || -L "${MARKER_FILE}" || -L "${INSTALL_DIR}" || -L "${SERVER_FILE}" || -L "${CONFIG_FILE}" || -L "${RUNTIME_ENV_FILE}" || -L "${SERVICE_FILE}" ]]; then
  echo "::error:: unsafe_symlink_detected subscription ownership path" >&2
  exit 1
fi
if [[ -e "${INSTALL_DIR}" && ! -d "${INSTALL_DIR}" ]]; then
  echo "::error:: invalid_subscription_install_directory" >&2
  exit 1
fi
for owned_file in "${SERVER_FILE}" "${CONFIG_FILE}" "${RUNTIME_ENV_FILE}" "${SERVICE_FILE}"; do
  if ! safe_regular_file "${owned_file}"; then
    echo "::error:: unsafe_subscription_file path=${owned_file}" >&2
    exit 1
  fi
done
if has_on_disk_dropins || [[ -n "$(systemctl show -p DropInPaths --value vps-subscription.service 2>/dev/null || true)" ]]; then
  echo "::error:: subscription_systemd_dropin_detected" >&2
  exit 1
fi
if ! effective_fragment_is_safe; then
  echo "::error:: subscription_effective_unit_not_owned" >&2
  exit 1
fi
if SHADOWED_UNIT="$(find_shadowed_unit)"; then
  echo "::error:: unmanaged_shadowed_subscription_unit path=${SHADOWED_UNIT}" >&2
  exit 1
fi

if [[ -e "${MARKER_FILE}" ]]; then
  if ! marker_is_valid; then
    echo "::error:: invalid_subscription_ownership_marker" >&2
    exit 1
  fi
  if [[ -e "${SERVICE_FILE}" ]]; then
    if ! current_unit_matches && ! legacy_assets_match; then
      echo "::error:: managed_subscription_unit_modified" >&2
      exit 1
    fi
  fi
else
  if [[ -e "${INSTALL_DIR}" || -e "${SERVICE_FILE}" ]] || systemctl cat vps-subscription.service >/dev/null 2>&1; then
    if legacy_assets_match; then
      echo "检测到 token 与本地记录一致的旧版 V-Swift 订阅服务，正在补建所有权标记。"
    else
      echo "::error:: unmanaged_subscription_service_detected" >&2
      echo "目标机已有无法证明属于本客户端的同名订阅服务或目录，已拒绝覆盖。" >&2
      exit 1
    fi
  fi
  install -d -m 700 "${MARKER_DIR}"
  MARKER_TMP="$(mktemp "${MARKER_FILE}.tmp.XXXXXX")"
  expected_marker > "${MARKER_TMP}"
  chmod 600 "${MARKER_TMP}"
  mv -f "${MARKER_TMP}" "${MARKER_FILE}"
  MARKER_TMP=""
fi

echo "正在创建受保护的订阅服务目录..."
install -d -m 700 "${INSTALL_DIR}"

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
trap - EXIT
