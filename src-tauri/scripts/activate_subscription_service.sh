#!/usr/bin/env bash
set -eEuo pipefail

STAGE_ID="${1:-}"
PORT="${2:-18080}"
LEGACY_TOKEN_HASH="${3:-}"
EXPECTED_SERVER_HASHES="${4:-}"
INSTALL_DIR="/opt/vps-subscription"
SERVER_FILE="${INSTALL_DIR}/subscription_server.py"
CONFIG_FILE="${INSTALL_DIR}/config.yaml"
RUNTIME_ENV_FILE="${INSTALL_DIR}/runtime.env"
SERVICE_FILE="/etc/systemd/system/vps-subscription.service"
MARKER_FILE="/var/lib/v-swift/managed/subscription"
SERVER_TMP="${INSTALL_DIR}/.v-swift-${STAGE_ID}-server.tmp"
CONFIG_TMP="${INSTALL_DIR}/.v-swift-${STAGE_ID}-config.tmp"
RUNTIME_ENV_TMP="${INSTALL_DIR}/.v-swift-${STAGE_ID}-env.tmp"
SERVICE_TMP="${INSTALL_DIR}/.v-swift-${STAGE_ID}-service.tmp"
SERVER_BACKUP="${INSTALL_DIR}/.v-swift-${STAGE_ID}-server.bak"
CONFIG_BACKUP="${INSTALL_DIR}/.v-swift-${STAGE_ID}-config.bak"
RUNTIME_ENV_BACKUP="${INSTALL_DIR}/.v-swift-${STAGE_ID}-env.bak"
SERVICE_BACKUP="${INSTALL_DIR}/.v-swift-${STAGE_ID}-service.bak"
SERVICE_STAGE="${SERVICE_FILE}.new.${STAGE_ID}"
SERVICE_RESTORE_STAGE="${SERVICE_FILE}.restore.${STAGE_ID}"
OLD_SERVER=0
OLD_CONFIG=0
OLD_RUNTIME_ENV=0
OLD_SERVICE=0
WAS_ENABLED=0
WAS_ACTIVE=0
ROLLBACK_REQUIRED=0
SERVICE_STAGE_CREATED=0
SERVICE_RESTORE_STAGE_CREATED=0
PRESERVE_BACKUPS=0

umask 077

cleanup_transient_files() {
  rm -f \
    "${SERVER_TMP}" "${CONFIG_TMP}" "${RUNTIME_ENV_TMP}" "${SERVICE_TMP}" \
    2>/dev/null || true
  if (( PRESERVE_BACKUPS == 0 )); then
    if (( OLD_SERVER == 1 )); then rm -f "${SERVER_BACKUP}" 2>/dev/null || true; fi
    if (( OLD_CONFIG == 1 )); then rm -f "${CONFIG_BACKUP}" 2>/dev/null || true; fi
    if (( OLD_RUNTIME_ENV == 1 )); then rm -f "${RUNTIME_ENV_BACKUP}" 2>/dev/null || true; fi
    if (( OLD_SERVICE == 1 )); then rm -f "${SERVICE_BACKUP}" 2>/dev/null || true; fi
  fi
  if (( SERVICE_STAGE_CREATED == 1 )); then rm -f "${SERVICE_STAGE}" 2>/dev/null || true; fi
  if (( SERVICE_RESTORE_STAGE_CREATED == 1 )); then rm -f "${SERVICE_RESTORE_STAGE}" 2>/dev/null || true; fi
  return 0
}

handle_exit() {
  local original_status=$?
  trap - EXIT
  if (( ROLLBACK_REQUIRED == 1 )); then
    rollback_activation "${original_status}"
  fi
  cleanup_transient_files
  exit "${original_status}"
}
trap handle_exit EXIT

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

expected_runtime_env() {
  local port="$1" iface="$2" token="$3"
  cat << ENVEOF
SUB_PORT=${port}
SUB_IFACE=${iface}
SUB_CONFIG_PATH=/opt/vps-subscription/config.yaml
SUB_TOTAL_BYTES=3000000000000
SUB_EXPIRE_TS=0
SUB_TOKEN=${token}
ENVEOF
}

current_unit_matches() {
  local path="$1"
  [[ -f "${path}" && ! -L "${path}" ]] && cmp -s "${path}" <(expected_current_unit)
}

legacy_unit_matches() {
  local path="$1"
  [[ -f "${path}" && ! -L "${path}" ]] || return 1
  local port iface token
  port="$(sed -n 's/^Environment=SUB_PORT=//p' "${path}" | head -n 1)"
  iface="$(sed -n 's/^Environment=SUB_IFACE=//p' "${path}" | head -n 1)"
  token="$(sed -n 's/^Environment=SUB_TOKEN=//p' "${path}" | head -n 1)"
  [[ "${port}" == "18080" ]] || return 1
  [[ "${iface}" =~ ^[A-Za-z0-9_.:-]+$ ]] || return 1
  [[ "${token}" =~ ^[0-9a-f]{32}$ ]] || return 1
  cmp -s "${path}" <(expected_legacy_unit "${port}" "${iface}" "${token}")
}

runtime_env_matches() {
  local path="$1"
  [[ -f "${path}" && ! -L "${path}" ]] || return 1
  local env_port iface token
  env_port="$(sed -n 's/^SUB_PORT=//p' "${path}" | head -n 1)"
  iface="$(sed -n 's/^SUB_IFACE=//p' "${path}" | head -n 1)"
  token="$(sed -n 's/^SUB_TOKEN=//p' "${path}" | head -n 1)"
  [[ "${env_port}" == "${PORT}" ]] || return 1
  [[ "${iface}" =~ ^[A-Za-z0-9_.:-]+$ ]] || return 1
  [[ "${token}" =~ ^[0-9a-f]{32}$ ]] || return 1
  cmp -s "${path}" <(expected_runtime_env "${env_port}" "${iface}" "${token}")
}

safe_regular_file() {
  local path="$1"
  [[ ! -e "${path}" ]] && return 0
  [[ -f "${path}" && ! -L "${path}" && "$(stat -c %h "${path}")" == "1" && "$(stat -c %u "${path}")" == "0" ]]
}

legacy_assets_match() {
  [[ "${LEGACY_TOKEN_HASH}" =~ ^[0-9a-f]{64}$ ]] || return 1
  [[ "${EXPECTED_SERVER_HASHES}" =~ ^[0-9a-f]{64}(,[0-9a-f]{64})*$ ]] || return 1
  legacy_unit_matches "${SERVICE_FILE}" || return 1
  [[ -f "${SERVER_FILE}" && -f "${CONFIG_FILE}" ]] || return 1
  local token current_hash server_hash
  token="$(sed -n 's/^Environment=SUB_TOKEN=//p' "${SERVICE_FILE}" | head -n 1)"
  current_hash="$(printf '%s' "${token}" | sha256sum | awk '{print $1}')"
  server_hash="$(sha256sum "${SERVER_FILE}" | awk '{print $1}')"
  [[ "${current_hash}" == "${LEGACY_TOKEN_HASH}" ]] && [[ ",${EXPECTED_SERVER_HASHES}," == *",${server_hash},"* ]]
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

rollback_activation() {
  local original_status="${1:-1}"
  trap - ERR EXIT HUP INT TERM
  if (( ROLLBACK_REQUIRED == 0 )); then
    cleanup_transient_files
    exit "${original_status}"
  fi

  set +e
  local rollback_incomplete=0
  if systemctl is-active --quiet vps-subscription; then
    systemctl stop vps-subscription >/dev/null 2>&1 || rollback_incomplete=1
  fi
  if systemctl is-active --quiet vps-subscription; then
    rollback_incomplete=1
  fi

  if (( OLD_SERVER == 1 )); then
    mv -f "${SERVER_BACKUP}" "${SERVER_FILE}" || rollback_incomplete=1
  else
    [[ ! -e "${SERVER_FILE}" ]] || unlink "${SERVER_FILE}" || rollback_incomplete=1
  fi
  if (( OLD_CONFIG == 1 )); then
    mv -f "${CONFIG_BACKUP}" "${CONFIG_FILE}" || rollback_incomplete=1
  else
    [[ ! -e "${CONFIG_FILE}" ]] || unlink "${CONFIG_FILE}" || rollback_incomplete=1
  fi
  if (( OLD_RUNTIME_ENV == 1 )); then
    mv -f "${RUNTIME_ENV_BACKUP}" "${RUNTIME_ENV_FILE}" || rollback_incomplete=1
  else
    [[ ! -e "${RUNTIME_ENV_FILE}" ]] || unlink "${RUNTIME_ENV_FILE}" || rollback_incomplete=1
  fi
  if (( OLD_SERVICE == 1 )); then
    SERVICE_RESTORE_STAGE_CREATED=1
    cp -p -- "${SERVICE_BACKUP}" "${SERVICE_RESTORE_STAGE}" || rollback_incomplete=1
    if [[ -e "${SERVICE_RESTORE_STAGE}" ]]; then
      mv -f "${SERVICE_RESTORE_STAGE}" "${SERVICE_FILE}" || rollback_incomplete=1
    fi
  else
    [[ ! -e "${SERVICE_FILE}" ]] || unlink "${SERVICE_FILE}" || rollback_incomplete=1
  fi

  systemctl daemon-reload || rollback_incomplete=1
  if (( WAS_ENABLED == 1 )); then
    systemctl enable vps-subscription >/dev/null 2>&1 || rollback_incomplete=1
    systemctl is-enabled --quiet vps-subscription || rollback_incomplete=1
  else
    if systemctl is-enabled --quiet vps-subscription; then
      systemctl disable vps-subscription >/dev/null 2>&1 || rollback_incomplete=1
    fi
    if systemctl is-enabled --quiet vps-subscription; then
      rollback_incomplete=1
    fi
  fi
  if (( WAS_ACTIVE == 1 )); then
    systemctl restart vps-subscription || rollback_incomplete=1
    systemctl is-active --quiet vps-subscription || rollback_incomplete=1
  else
    if systemctl is-active --quiet vps-subscription; then
      systemctl stop vps-subscription >/dev/null 2>&1 || rollback_incomplete=1
    fi
    if systemctl is-active --quiet vps-subscription; then
      rollback_incomplete=1
    fi
  fi

  echo "::error:: subscription_activation_failed_previous_version_restored" >&2
  if (( rollback_incomplete == 1 )); then
    PRESERVE_BACKUPS=1
    echo "::error:: rollback_incomplete subscription service requires manual recovery" >&2
    echo "::error:: recovery_backups_preserved stage=${STAGE_ID} directory=${INSTALL_DIR}" >&2
  fi
  (( original_status != 0 )) || original_status=1
  cleanup_transient_files
  exit "${original_status}"
}
trap 'rollback_activation $?' ERR
trap 'rollback_activation 129' HUP
trap 'rollback_activation 130' INT
trap 'rollback_activation 143' TERM

if ! [[ "${STAGE_ID}" =~ ^[0-9a-f]{32}$ ]]; then
  echo "::error:: invalid_subscription_stage_id" >&2
  exit 1
fi
if ! [[ "${PORT}" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  echo "::error:: invalid_subscription_port" >&2
  exit 1
fi
if ! [[ "${LEGACY_TOKEN_HASH}" =~ ^[0-9a-f]{64}$ ]]; then
  echo "::error:: invalid_legacy_subscription_token_hash" >&2
  exit 1
fi
if ! [[ "${EXPECTED_SERVER_HASHES}" =~ ^[0-9a-f]{64}(,[0-9a-f]{64})*$ ]]; then
  echo "::error:: invalid_subscription_server_hash_allowlist" >&2
  exit 1
fi
if [[ -L "${INSTALL_DIR}" || -L "${SERVER_FILE}" || -L "${CONFIG_FILE}" || -L "${RUNTIME_ENV_FILE}" || -L "${SERVICE_FILE}" || -L "${MARKER_FILE}" ]]; then
  echo "::error:: unsafe_symlink_detected subscription activate path" >&2
  exit 1
fi
if [[ ! -d "${INSTALL_DIR}" ]]; then
  echo "::error:: invalid_subscription_install_directory" >&2
  exit 1
fi
if [[ ! -f "${MARKER_FILE}" || -L "${MARKER_FILE}" || "$(stat -c %h "${MARKER_FILE}")" != "1" || "$(stat -c %u "${MARKER_FILE}")" != "0" ]] || ! cmp -s "${MARKER_FILE}" <(expected_marker); then
  echo "::error:: invalid_subscription_ownership_marker" >&2
  exit 1
fi
for staged_file in "${SERVER_TMP}" "${CONFIG_TMP}" "${RUNTIME_ENV_TMP}" "${SERVICE_TMP}"; do
  if [[ ! -f "${staged_file}" || -L "${staged_file}" || "$(stat -c %h "${staged_file}")" != "1" || "$(stat -c %u "${staged_file}")" != "0" ]]; then
    echo "::error:: unsafe_subscription_staging_file path=${staged_file}" >&2
    exit 1
  fi
done
for transient_file in "${SERVER_BACKUP}" "${CONFIG_BACKUP}" "${RUNTIME_ENV_BACKUP}" "${SERVICE_BACKUP}" "${SERVICE_STAGE}" "${SERVICE_RESTORE_STAGE}"; do
  if [[ -e "${transient_file}" || -L "${transient_file}" ]]; then
    echo "::error:: subscription_stage_collision path=${transient_file}" >&2
    exit 1
  fi
done
for owned_file in "${SERVER_FILE}" "${CONFIG_FILE}" "${RUNTIME_ENV_FILE}" "${SERVICE_FILE}"; do
  if ! safe_regular_file "${owned_file}"; then
    echo "::error:: unsafe_subscription_file path=${owned_file}" >&2
    exit 1
  fi
done
if [[ -e "${SERVICE_FILE}" ]] && ! current_unit_matches "${SERVICE_FILE}" && ! legacy_assets_match; then
  echo "::error:: managed_subscription_unit_modified" >&2
  exit 1
fi
if ! current_unit_matches "${SERVICE_TMP}"; then
  echo "::error:: invalid_staged_subscription_unit" >&2
  exit 1
fi
if ! runtime_env_matches "${RUNTIME_ENV_TMP}"; then
  echo "::error:: invalid_staged_subscription_environment" >&2
  exit 1
fi
CURRENT_SERVER_HASH="${EXPECTED_SERVER_HASHES%%,*}"
if [[ "$(sha256sum "${SERVER_TMP}" | awk '{print $1}')" != "${CURRENT_SERVER_HASH}" ]]; then
  echo "::error:: invalid_staged_subscription_server" >&2
  exit 1
fi
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

if systemctl is-enabled --quiet vps-subscription.service; then
  WAS_ENABLED=1
fi
if systemctl is-active --quiet vps-subscription.service; then
  WAS_ACTIVE=1
fi
if [[ -e "${SERVER_FILE}" ]]; then
  OLD_SERVER=1
  cp -p -- "${SERVER_FILE}" "${SERVER_BACKUP}"
fi
if [[ -e "${CONFIG_FILE}" ]]; then
  OLD_CONFIG=1
  cp -p -- "${CONFIG_FILE}" "${CONFIG_BACKUP}"
fi
if [[ -e "${RUNTIME_ENV_FILE}" ]]; then
  OLD_RUNTIME_ENV=1
  cp -p -- "${RUNTIME_ENV_FILE}" "${RUNTIME_ENV_BACKUP}"
fi
if [[ -e "${SERVICE_FILE}" ]]; then
  OLD_SERVICE=1
  cp -p -- "${SERVICE_FILE}" "${SERVICE_BACKUP}"
fi

chmod 755 "${SERVER_TMP}"
chmod 600 "${CONFIG_TMP}" "${RUNTIME_ENV_TMP}"
SERVICE_STAGE_CREATED=1
install -m 644 "${SERVICE_TMP}" "${SERVICE_STAGE}"

ROLLBACK_REQUIRED=1
mv -f "${SERVER_TMP}" "${SERVER_FILE}"
mv -f "${CONFIG_TMP}" "${CONFIG_FILE}"
mv -f "${RUNTIME_ENV_TMP}" "${RUNTIME_ENV_FILE}"
mv -f "${SERVICE_STAGE}" "${SERVICE_FILE}"

systemctl daemon-reload
systemctl enable vps-subscription
systemctl restart vps-subscription
sleep 1

if ! systemctl is-active --quiet vps-subscription; then
  echo "::error:: subscription_service_not_active" >&2
  systemctl status vps-subscription --no-pager -l >&2 || true
  journalctl -u vps-subscription -n 50 --no-pager >&2 || true
  false
fi

curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null
ROLLBACK_REQUIRED=0
trap - ERR HUP INT TERM
cleanup_transient_files
trap - EXIT
echo "远程订阅服务已启动并通过本机健康检查。"
