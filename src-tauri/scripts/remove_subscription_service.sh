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

expected_marker() {
  cat << 'MARKEREOF'
managed-by=v-swift
resource=vps-subscription
schema=1
MARKEREOF
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

legacy_assets_match() {
  [[ "${LEGACY_TOKEN_HASH}" =~ ^[0-9a-f]{64}$ ]] || return 1
  [[ "${EXPECTED_SERVER_HASHES}" =~ ^[0-9a-f]{64}(,[0-9a-f]{64})*$ ]] || return 1
  legacy_unit_matches || return 1
  [[ -f "${SERVER_FILE}" && -f "${CONFIG_FILE}" ]] || return 1
  local token current_hash server_hash
  token="$(sed -n 's/^Environment=SUB_TOKEN=//p' "${SERVICE_FILE}" | head -n 1)"
  current_hash="$(printf '%s' "${token}" | sha256sum | awk '{print $1}')"
  server_hash="$(sha256sum "${SERVER_FILE}" | awk '{print $1}')"
  [[ "${current_hash}" == "${LEGACY_TOKEN_HASH}" ]] && [[ ",${EXPECTED_SERVER_HASHES}," == *",${server_hash},"* ]]
}

safe_regular_file() {
  local path="$1"
  [[ ! -e "${path}" ]] && return 0
  [[ -f "${path}" && ! -L "${path}" && "$(stat -c %h "${path}")" == "1" && "$(stat -c %u "${path}")" == "0" ]]
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
    if [[ -n "${active_state}" && "${active_state}" != "inactive" && "${active_state}" != "failed" ]]; then
      [[ "${fragment}" == "${SERVICE_FILE}" ]]
    fi
    return
  fi
  [[ "${fragment}" == "${SERVICE_FILE}" ]]
}

if [[ ! -e "${MARKER_FILE}" && ! -e "${INSTALL_DIR}" && ! -e "${SERVICE_FILE}" ]] && ! systemctl cat vps-subscription.service >/dev/null 2>&1; then
  echo "远程订阅服务已不存在。"
  exit 0
fi
if [[ -L "${MARKER_DIR}" || -L "${MARKER_FILE}" || -L "${INSTALL_DIR}" || -L "${SERVER_FILE}" || -L "${CONFIG_FILE}" || -L "${RUNTIME_ENV_FILE}" || -L "${SERVICE_FILE}" ]]; then
  echo "::error:: unsafe_symlink_detected subscription remove path" >&2
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
if SHADOWED_UNIT="$(find_shadowed_unit)"; then
  echo "::error:: unmanaged_shadowed_subscription_unit path=${SHADOWED_UNIT}" >&2
  exit 1
fi
if ! effective_fragment_is_safe; then
  echo "::error:: subscription_effective_unit_not_owned" >&2
  exit 1
fi

if [[ -e "${MARKER_FILE}" ]]; then
  if [[ ! -f "${MARKER_FILE}" || "$(stat -c %h "${MARKER_FILE}")" != "1" || "$(stat -c %u "${MARKER_FILE}")" != "0" ]] || ! cmp -s "${MARKER_FILE}" <(expected_marker); then
    echo "::error:: invalid_subscription_ownership_marker" >&2
    exit 1
  fi
  if [[ -e "${SERVICE_FILE}" ]] && ! current_unit_matches && ! legacy_assets_match; then
    echo "::error:: managed_subscription_unit_modified" >&2
    exit 1
  fi
elif legacy_assets_match; then
  echo "检测到 token 与本地记录一致的旧版 V-Swift 订阅服务，允许安全迁移卸载。"
else
  echo "::error:: unmanaged_subscription_service_detected" >&2
  exit 1
fi

if systemctl is-active --quiet vps-subscription; then
  systemctl stop vps-subscription
fi
if systemctl is-active --quiet vps-subscription; then
  echo "::error:: subscription_service_still_active_after_stop" >&2
  exit 1
fi
if systemctl is-enabled --quiet vps-subscription; then
  systemctl disable vps-subscription
fi

[[ ! -e "${SERVICE_FILE}" ]] || unlink "${SERVICE_FILE}"
systemctl daemon-reload
[[ ! -e "${SERVER_FILE}" ]] || unlink "${SERVER_FILE}"
[[ ! -e "${CONFIG_FILE}" ]] || unlink "${CONFIG_FILE}"
[[ ! -e "${RUNTIME_ENV_FILE}" ]] || unlink "${RUNTIME_ENV_FILE}"
INSTALL_DIR_REMOVED=1
if [[ -d "${INSTALL_DIR}" ]] && ! rmdir "${INSTALL_DIR}" 2>/dev/null; then
  INSTALL_DIR_REMOVED=0
  echo "::warning:: subscription_directory_not_empty path=${INSTALL_DIR}" >&2
  echo "::warning:: ownership_marker_retained_for_retry" >&2
fi
if (( INSTALL_DIR_REMOVED == 0 )); then
  echo "::error:: subscription_cleanup_incomplete ownership marker retained; inspect unexpected or stale files" >&2
  exit 1
fi
[[ ! -e "${MARKER_FILE}" ]] || unlink "${MARKER_FILE}"
rmdir "${MARKER_DIR}" 2>/dev/null || true
rmdir /var/lib/v-swift 2>/dev/null || true
echo "V-Swift 管理的远程订阅服务文件已移除。"
