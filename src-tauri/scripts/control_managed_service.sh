#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-}"
PROTOCOL="${2:-}"
EXPECTED_OWNERSHIP_HASH="${3:-}"
MARKER_TMP=""

cleanup_marker_tmp() {
  [[ -z "${MARKER_TMP}" || ! -e "${MARKER_TMP}" ]] || rm -f -- "${MARKER_TMP}"
}
trap cleanup_marker_tmp EXIT

case "${ACTION}" in
  start|stop|restart) ;;
  *)
    echo "::error:: invalid_control_action" >&2
    exit 2
    ;;
esac

if ! [[ "${EXPECTED_OWNERSHIP_HASH}" =~ ^[0-9a-f]{64}$ ]]; then
  echo "::error:: invalid_expected_ownership_hash" >&2
  exit 2
fi

if [[ "$(id -u)" != "0" ]]; then
  echo "::error:: root_required_for_service_control" >&2
  echo "V-Swift 部署契约要求使用 root SSH 用户；拒绝通过 sudo 隐式提升权限。" >&2
  exit 1
fi

case "${PROTOCOL}" in
  xray)
    SERVICE_NAME="xray.service"
    SERVICE_FILE="/etc/systemd/system/xray.service"
    CONFIG_DIR="/usr/local/etc/xray"
    CONFIG_FILE="${CONFIG_DIR}/config.json"
    MARKER_DIR="/var/lib/v-swift/managed"
    MARKER_FILE="${MARKER_DIR}/xray"
    DROPIN_NAMES=("xray.service.d" "service.d")
    SHADOWED_UNITS=(
      /etc/systemd/system.control/xray.service
      /run/systemd/system.control/xray.service
      /run/systemd/transient/xray.service
      /run/systemd/generator.early/xray.service
      /etc/systemd/system.attached/xray.service
      /run/systemd/system/xray.service
      /run/systemd/system.attached/xray.service
      /run/systemd/generator/xray.service
      /usr/local/lib/systemd/system/xray.service
      /usr/lib/systemd/system/xray.service
      /lib/systemd/system/xray.service
      /run/systemd/generator.late/xray.service
    )
    ;;
  hysteria2)
    SERVICE_NAME="hysteria-server.service"
    SERVICE_FILE="/etc/systemd/system/hysteria-server.service"
    CONFIG_DIR="/etc/hysteria"
    CONFIG_FILE="${CONFIG_DIR}/config.yaml"
    CERT_FILE="${CONFIG_DIR}/server.crt"
    KEY_FILE="${CONFIG_DIR}/server.key"
    MARKER_DIR="/var/lib/v-swift/managed"
    MARKER_FILE="${MARKER_DIR}/hysteria2"
    DROPIN_NAMES=("hysteria-server.service.d" "hysteria-.service.d" "service.d")
    SHADOWED_UNITS=(
      /etc/systemd/system.control/hysteria-server.service
      /run/systemd/system.control/hysteria-server.service
      /run/systemd/transient/hysteria-server.service
      /run/systemd/generator.early/hysteria-server.service
      /etc/systemd/system.attached/hysteria-server.service
      /run/systemd/system/hysteria-server.service
      /run/systemd/system.attached/hysteria-server.service
      /run/systemd/generator/hysteria-server.service
      /usr/local/lib/systemd/system/hysteria-server.service
      /usr/lib/systemd/system/hysteria-server.service
      /lib/systemd/system/hysteria-server.service
      /run/systemd/generator.late/hysteria-server.service
    )
    ;;
  *)
    echo "::error:: unsupported_control_protocol" >&2
    exit 2
    ;;
esac

expected_service_unit() {
  case "${PROTOCOL}" in
    xray)
      cat << 'SVCEOF'
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
      ;;
    hysteria2)
      cat << 'SVCEOF'
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
      ;;
  esac
}

fail_ownership_check() {
  local code="$1"
  echo "::error:: ${code}" >&2
  echo "远端服务不再满足 V-Swift 所有权契约，已拒绝执行 ${ACTION}。" >&2
  exit 1
}

regular_root_owned_single_link() {
  local path="$1"
  local expected_mode="$2"
  [[ -f "${path}" && ! -L "${path}" ]] || return 1
  [[ "$(stat -c %u "${path}" 2>/dev/null)" == "0" ]] || return 1
  [[ "$(stat -c %h "${path}" 2>/dev/null)" == "1" ]] || return 1
  [[ "$(stat -c %a "${path}" 2>/dev/null)" == "${expected_mode}" ]]
}

safe_root_owned_directory() {
  local path="$1"
  local mode
  [[ -d "${path}" && ! -L "${path}" ]] || return 1
  [[ "$(stat -c %u "${path}" 2>/dev/null)" == "0" ]] || return 1
  mode="$(stat -c %a "${path}" 2>/dev/null)"
  [[ "${mode}" =~ ^[0-7]*[0145][0145]$ ]]
}

strict_managed_marker_directory() {
  [[ -d "${MARKER_DIR}" && ! -L "${MARKER_DIR}" ]] || return 1
  [[ "$(stat -c %u "${MARKER_DIR}" 2>/dev/null)" == "0" ]] || return 1
  [[ "$(stat -c %a "${MARKER_DIR}" 2>/dev/null)" == "700" ]]
}

valid_ownership_marker() {
  strict_managed_marker_directory || return 1
  regular_root_owned_single_link "${MARKER_FILE}" 600 || return 1
  cmp -s "${MARKER_FILE}" <(printf '%s\n' 'managed-by=v-swift')
}

ensure_legacy_marker_directory() {
  local state_root="/var/lib/v-swift"

  if [[ -e "${state_root}" || -L "${state_root}" ]]; then
    safe_root_owned_directory "${state_root}" ||
      fail_ownership_check "invalid_v_swift_state_directory"
  else
    if ! mkdir -m 700 -- "${state_root}" 2>/dev/null; then
      safe_root_owned_directory "${state_root}" ||
        fail_ownership_check "invalid_v_swift_state_directory"
    fi
  fi

  if [[ -e "${MARKER_DIR}" || -L "${MARKER_DIR}" ]]; then
    strict_managed_marker_directory ||
      fail_ownership_check "invalid_managed_marker_directory"
  else
    if ! mkdir -m 700 -- "${MARKER_DIR}" 2>/dev/null; then
      strict_managed_marker_directory ||
        fail_ownership_check "invalid_managed_marker_directory"
    fi
  fi
}

migrate_legacy_ownership_marker() {
  ensure_legacy_marker_directory

  if [[ -e "${MARKER_FILE}" || -L "${MARKER_FILE}" ]]; then
    valid_ownership_marker ||
      fail_ownership_check "invalid_${PROTOCOL}_ownership_marker"
    return
  fi

  MARKER_TMP="$(mktemp "${MARKER_DIR}/.${PROTOCOL}.tmp.XXXXXX")"
  printf '%s\n' 'managed-by=v-swift' > "${MARKER_TMP}"
  chmod 600 "${MARKER_TMP}"
  if ! regular_root_owned_single_link "${MARKER_TMP}" 600; then
    fail_ownership_check "invalid_${PROTOCOL}_ownership_marker_temp"
  fi

  # The directory is root-owned mode 0700. Linking a same-directory temporary
  # file publishes the marker atomically without overwriting a concurrent one.
  if ! ln -- "${MARKER_TMP}" "${MARKER_FILE}" 2>/dev/null; then
    valid_ownership_marker ||
      fail_ownership_check "invalid_${PROTOCOL}_ownership_marker"
  fi
  rm -f -- "${MARKER_TMP}"
  MARKER_TMP=""

  valid_ownership_marker ||
    fail_ownership_check "invalid_${PROTOCOL}_ownership_marker"
  echo "检测到与本地节点凭据一致的早期 V-Swift ${PROTOCOL} 配置，已补建所有权标记。"
}

if ! regular_root_owned_single_link "${SERVICE_FILE}" 644 || ! cmp -s "${SERVICE_FILE}" <(expected_service_unit); then
  fail_ownership_check "managed_${PROTOCOL}_unit_modified"
fi

LOAD_STATE="$(systemctl show -p LoadState --value "${SERVICE_NAME}" 2>/dev/null || true)"
FRAGMENT_PATH="$(systemctl show -p FragmentPath --value "${SERVICE_NAME}" 2>/dev/null || true)"
DROPIN_PATHS="$(systemctl show -p DropInPaths --value "${SERVICE_NAME}" 2>/dev/null || true)"
if [[ "${LOAD_STATE}" != "loaded" || "${FRAGMENT_PATH}" != "${SERVICE_FILE}" ]]; then
  fail_ownership_check "${PROTOCOL}_effective_unit_not_owned"
fi
if [[ -n "${DROPIN_PATHS}" ]]; then
  fail_ownership_check "${PROTOCOL}_systemd_dropin_detected"
fi

for shadowed_unit in "${SHADOWED_UNITS[@]}"; do
  if [[ -e "${shadowed_unit}" || -L "${shadowed_unit}" ]]; then
    fail_ownership_check "unmanaged_shadowed_${PROTOCOL}_unit"
  fi
done

for root in /etc/systemd/system /run/systemd/system /usr/local/lib/systemd/system /usr/lib/systemd/system /lib/systemd/system; do
  for dropin_name in "${DROPIN_NAMES[@]}"; do
    dropin_dir="${root}/${dropin_name}"
    if [[ -L "${dropin_dir}" ]] ||
      { [[ -d "${dropin_dir}" ]] && [[ -n "$(find "${dropin_dir}" -mindepth 1 -maxdepth 1 -name '*.conf' \( -type f -o -type l \) -print -quit 2>/dev/null)" ]]; }; then
      fail_ownership_check "${PROTOCOL}_systemd_dropin_detected"
    fi
  done
done

if ! safe_root_owned_directory "${CONFIG_DIR}" ||
  ! regular_root_owned_single_link "${CONFIG_FILE}" 600; then
  fail_ownership_check "invalid_${PROTOCOL}_managed_config"
fi

case "${PROTOCOL}" in
  xray)
    if ! command -v jq >/dev/null 2>&1; then
      fail_ownership_check "xray_config_verifier_unavailable"
    fi
    CURRENT_SECRET="$(jq -r '.inbounds[]? | select(.protocol == "vless") | .settings.clients[0].id // empty' "${CONFIG_FILE}" 2>/dev/null | head -n 1)"
    ;;
  hysteria2)
    if ! regular_root_owned_single_link "${CERT_FILE}" 644 || ! regular_root_owned_single_link "${KEY_FILE}" 600; then
      fail_ownership_check "invalid_hysteria2_managed_certificate"
    fi
    CURRENT_SECRET="$(sed -n 's/^[[:space:]]*password:[[:space:]]*"\(.*\)"[[:space:]]*$/\1/p' "${CONFIG_FILE}" | head -n 1)"
    ;;
esac

if [[ -z "${CURRENT_SECRET}" ]]; then
  fail_ownership_check "missing_${PROTOCOL}_ownership_secret"
fi
CURRENT_OWNERSHIP_HASH="$(printf '%s' "${CURRENT_SECRET}" | sha256sum | awk '{print $1}')"
unset CURRENT_SECRET
if [[ "${CURRENT_OWNERSHIP_HASH}" != "${EXPECTED_OWNERSHIP_HASH}" ]]; then
  fail_ownership_check "managed_${PROTOCOL}_config_no_longer_matches_local_node"
fi

if [[ -e "${MARKER_FILE}" || -L "${MARKER_FILE}" ]]; then
  valid_ownership_marker ||
    fail_ownership_check "invalid_${PROTOCOL}_ownership_marker"
else
  migrate_legacy_ownership_marker
fi

if ! systemctl "${ACTION}" "${SERVICE_NAME}"; then
  echo "::error:: ${PROTOCOL}_service_${ACTION}_failed" >&2
  exit 1
fi

case "${ACTION}" in
  start|restart)
    if ! systemctl is-active --quiet "${SERVICE_NAME}"; then
      echo "::error:: ${PROTOCOL}_service_not_active_after_${ACTION}" >&2
      exit 1
    fi
    ;;
  stop)
    if systemctl is-active --quiet "${SERVICE_NAME}"; then
      echo "::error:: ${PROTOCOL}_service_still_active_after_stop" >&2
      exit 1
    fi
    ;;
esac
