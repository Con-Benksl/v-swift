#!/usr/bin/env bash
set -euo pipefail

LEGACY_OWNERSHIP_HASH="${1:-}"
SERVICE_FILE="/etc/systemd/system/hysteria-server.service"
CONFIG_DIR="/etc/hysteria"
CONFIG_FILE="${CONFIG_DIR}/config.yaml"
CERT_FILE="${CONFIG_DIR}/server.crt"
KEY_FILE="${CONFIG_DIR}/server.key"
MARKER_DIR="/var/lib/v-swift/managed"
MARKER_FILE="${MARKER_DIR}/hysteria2"

if [[ ! -e "${MARKER_FILE}" && ! -L "${MARKER_FILE}" && ! -e "${SERVICE_FILE}" && ! -L "${SERVICE_FILE}" && ! -e "${CONFIG_FILE}" && ! -L "${CONFIG_FILE}" && ! -e "${CERT_FILE}" && ! -L "${CERT_FILE}" && ! -e "${KEY_FILE}" && ! -L "${KEY_FILE}" ]] &&
  ! systemctl is-active --quiet hysteria-server.service &&
  ! systemctl is-enabled --quiet hysteria-server.service &&
  ! systemctl cat hysteria-server.service >/dev/null 2>&1; then
  echo "V-Swift 管理的 Hysteria2 服务已不存在。"
  exit 0
fi

expected_service_unit() {
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
}

unit_matches_v_swift() {
  [[ -f "${SERVICE_FILE}" ]] && cmp -s "${SERVICE_FILE}" <(expected_service_unit)
}

config_matches_local_record() {
  [[ -n "${LEGACY_OWNERSHIP_HASH}" && -f "${CONFIG_FILE}" ]] || return 1
  local current_secret current_hash
  current_secret="$(sed -n 's/^[[:space:]]*password:[[:space:]]*"\(.*\)"[[:space:]]*$/\1/p' "${CONFIG_FILE}" | head -n 1)"
  [[ -n "${current_secret}" ]] || return 1
  current_hash="$(printf '%s' "${current_secret}" | sha256sum | awk '{print $1}')"
  [[ "${current_hash}" == "${LEGACY_OWNERSHIP_HASH}" ]]
}

legacy_install_matches_local_record() {
  unit_matches_v_swift && config_matches_local_record
}

has_on_disk_dropins() {
  local root dropin_dir
  for root in /etc/systemd/system /run/systemd/system /usr/local/lib/systemd/system /usr/lib/systemd/system /lib/systemd/system; do
    for dropin_dir in "${root}/hysteria-server.service.d" "${root}/hysteria-.service.d" "${root}/service.d"; do
      if [[ -L "${dropin_dir}" ]] || { [[ -d "${dropin_dir}" ]] && [[ -n "$(find "${dropin_dir}" -mindepth 1 -maxdepth 1 -name '*.conf' \( -type f -o -type l \) -print -quit 2>/dev/null)" ]]; }; then
        return 0
      fi
    done
  done
  return 1
}

effective_fragment_is_owned() {
  local fragment load_state active_state
  fragment="$(systemctl show -p FragmentPath --value hysteria-server.service 2>/dev/null || true)"
  load_state="$(systemctl show -p LoadState --value hysteria-server.service 2>/dev/null || true)"
  active_state="$(systemctl show -p ActiveState --value hysteria-server.service 2>/dev/null || true)"
  if [[ -z "${load_state}" || "${load_state}" == "not-found" ]]; then
    if [[ -n "${active_state}" && "${active_state}" != "inactive" && "${active_state}" != "failed" ]]; then
      [[ "${fragment}" == "${SERVICE_FILE}" ]]
    fi
    return
  fi
  [[ "${fragment}" == "${SERVICE_FILE}" ]]
}

find_shadowed_unit() {
  local candidate
  for candidate in \
    /etc/systemd/system.control/hysteria-server.service \
    /run/systemd/system.control/hysteria-server.service \
    /run/systemd/transient/hysteria-server.service \
    /run/systemd/generator.early/hysteria-server.service \
    /etc/systemd/system.attached/hysteria-server.service \
    /run/systemd/system/hysteria-server.service \
    /run/systemd/system.attached/hysteria-server.service \
    /run/systemd/generator/hysteria-server.service \
    /usr/local/lib/systemd/system/hysteria-server.service \
    /usr/lib/systemd/system/hysteria-server.service \
    /lib/systemd/system/hysteria-server.service \
    /run/systemd/generator.late/hysteria-server.service; do
    if [[ -e "${candidate}" || -L "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done
  return 1
}

if [[ -L "${MARKER_DIR}" || -L "${MARKER_FILE}" || -L "${SERVICE_FILE}" || -L "${CONFIG_DIR}" || -L "${CONFIG_FILE}" || -L "${CERT_FILE}" || -L "${KEY_FILE}" ]]; then
  echo "::error:: unsafe_symlink_detected hysteria2 ownership/config path" >&2
  exit 1
fi
if has_on_disk_dropins || [[ -n "$(systemctl show -p DropInPaths --value hysteria-server.service 2>/dev/null || true)" ]]; then
  echo "::error:: hysteria2_systemd_dropin_detected" >&2
  exit 1
fi
if ! effective_fragment_is_owned; then
  echo "::error:: hysteria2_effective_unit_not_owned" >&2
  exit 1
fi
if SHADOWED_UNIT="$(find_shadowed_unit)"; then
  echo "::error:: unmanaged_shadowed_hysteria2_unit path=${SHADOWED_UNIT}" >&2
  echo "删除 V-Swift unit 会暴露同名外部服务；为避免继续删除其可能依赖的配置，已拒绝卸载。" >&2
  exit 1
fi
if [[ -f "${MARKER_FILE}" ]]; then
  if [[ "$(stat -c %h "${MARKER_FILE}")" != "1" || "$(stat -c %u "${MARKER_FILE}")" != "0" ]] ||
    ! cmp -s "${MARKER_FILE}" <(printf '%s\n' 'managed-by=v-swift'); then
    echo "::error:: invalid_hysteria2_ownership_marker" >&2
    exit 1
  fi
else
  if legacy_install_matches_local_record; then
    echo "检测到与本地节点凭据一致的早期 V-Swift Hysteria2 配置，允许安全迁移卸载。"
  else
    echo "::error:: unmanaged_hysteria2_detected" >&2
    echo "远端 Hysteria2 缺少 V-Swift 所有权标记，且配置与本地节点不匹配；已拒绝卸载。" >&2
    exit 1
  fi
fi
if [[ -f "${SERVICE_FILE}" ]] && ! unit_matches_v_swift; then
  echo "::error:: managed_hysteria2_unit_modified" >&2
  echo "Hysteria2 服务文件已被外部修改，已拒绝删除。" >&2
  exit 1
fi
if [[ -f "${CONFIG_FILE}" ]] && ! config_matches_local_record; then
  echo "::error:: managed_hysteria2_config_no_longer_matches_local_node" >&2
  echo "远端 Hysteria2 配置与本地节点凭据不一致，已拒绝删除。" >&2
  exit 1
fi
if [[ ! -f "${CONFIG_FILE}" && ( -e "${CERT_FILE}" || -e "${KEY_FILE}" ) ]]; then
  echo "::error:: unmanaged_hysteria2_certificate_without_owned_config" >&2
  exit 1
fi

echo "正在停止并禁用 Hysteria2 服务..."
if systemctl is-active --quiet hysteria-server; then
  systemctl stop hysteria-server
fi
if systemctl is-active --quiet hysteria-server; then
  echo "::error:: hysteria2_service_still_active_after_stop" >&2
  exit 1
fi
if systemctl is-enabled --quiet hysteria-server; then
  systemctl disable hysteria-server
fi

echo "正在删除 systemd 服务文件..."
[[ ! -e "${SERVICE_FILE}" ]] || unlink "${SERVICE_FILE}"

systemctl daemon-reload

echo "保留共享 Hysteria2 二进制文件，避免影响其他服务。"

echo "正在删除 V-Swift 管理的 Hysteria2 配置..."
if [[ -d "${CONFIG_DIR}" ]]; then
  [[ ! -f "${CERT_FILE}" ]] || unlink "${CERT_FILE}"
  [[ ! -f "${KEY_FILE}" ]] || unlink "${KEY_FILE}"
  # Keep the credential-bearing config until the end so a partial failure remains
  # provably retryable through config_matches_local_record.
  [[ ! -f "${CONFIG_FILE}" ]] || unlink "${CONFIG_FILE}"
  rmdir "${CONFIG_DIR}" 2>/dev/null || true
fi

[[ ! -f "${MARKER_FILE}" ]] || unlink "${MARKER_FILE}"
rmdir "${MARKER_DIR}" 2>/dev/null || true
rmdir /var/lib/v-swift 2>/dev/null || true

echo "::info:: firewall rules not removed"
echo "V-Swift 管理的 Hysteria2 配置卸载完成。"
