#!/usr/bin/env bash
set -euo pipefail

ARCH="${1:-}"
LEGACY_OWNERSHIP_HASH="${2:-}"
if [[ -z "${ARCH}" ]]; then
  echo "::error:: missing_argument arch required as argument 1"
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
CONFIG_FILE="${CONFIG_DIR}/config.json"
MARKER_DIR="/var/lib/v-swift/managed"
MARKER_FILE="${MARKER_DIR}/xray"
MARKER_TMP=""
UNIT_TMP=""

cleanup_temp_files() {
  [[ -z "${MARKER_TMP}" || ! -e "${MARKER_TMP}" ]] || rm -f "${MARKER_TMP}"
  [[ -z "${UNIT_TMP}" || ! -e "${UNIT_TMP}" ]] || rm -f "${UNIT_TMP}"
}
trap cleanup_temp_files EXIT

expected_service_unit() {
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
}

unit_matches_v_swift() {
  [[ -f "${SERVICE_FILE}" ]] && cmp -s "${SERVICE_FILE}" <(expected_service_unit)
}

config_matches_local_record() {
  [[ -n "${LEGACY_OWNERSHIP_HASH}" && -f "${CONFIG_FILE}" ]] || return 1
  local current_secret current_hash
  current_secret="$(jq -r '.inbounds[]? | select(.protocol == "vless") | .settings.clients[0].id // empty' "${CONFIG_FILE}" 2>/dev/null | head -n 1)"
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
    for dropin_dir in "${root}/xray.service.d" "${root}/service.d"; do
      if [[ -L "${dropin_dir}" ]] || { [[ -d "${dropin_dir}" ]] && [[ -n "$(find "${dropin_dir}" -mindepth 1 -maxdepth 1 -name '*.conf' \( -type f -o -type l \) -print -quit 2>/dev/null)" ]]; }; then
        return 0
      fi
    done
  done
  return 1
}

effective_fragment_is_owned() {
  local fragment load_state active_state
  fragment="$(systemctl show -p FragmentPath --value xray.service 2>/dev/null || true)"
  load_state="$(systemctl show -p LoadState --value xray.service 2>/dev/null || true)"
  active_state="$(systemctl show -p ActiveState --value xray.service 2>/dev/null || true)"
  if [[ -z "${load_state}" || "${load_state}" == "not-found" ]]; then
    [[ -z "${active_state}" || "${active_state}" == "inactive" || "${active_state}" == "failed" ]] && ! systemctl is-enabled --quiet xray.service
    return
  fi
  [[ "${fragment}" == "${SERVICE_FILE}" ]]
}

find_shadowed_unit() {
  local candidate
  for candidate in \
    /etc/systemd/system.control/xray.service \
    /run/systemd/system.control/xray.service \
    /run/systemd/transient/xray.service \
    /run/systemd/generator.early/xray.service \
    /etc/systemd/system.attached/xray.service \
    /run/systemd/system/xray.service \
    /run/systemd/system.attached/xray.service \
    /run/systemd/generator/xray.service \
    /usr/local/lib/systemd/system/xray.service \
    /usr/lib/systemd/system/xray.service \
    /lib/systemd/system/xray.service \
    /run/systemd/generator.late/xray.service; do
    if [[ -e "${candidate}" || -L "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done
  return 1
}

if [[ -L "${MARKER_DIR}" || -L "${MARKER_FILE}" || -L "${SERVICE_FILE}" || -L "${CONFIG_DIR}" || -L "${CONFIG_FILE}" ]]; then
  echo "::error:: unsafe_symlink_detected xray ownership/config path" >&2
  exit 1
fi
if has_on_disk_dropins || [[ -n "$(systemctl show -p DropInPaths --value xray.service 2>/dev/null || true)" ]]; then
  echo "::error:: xray_systemd_dropin_detected" >&2
  echo "检测到外部 Xray systemd drop-in，拒绝覆盖有效服务定义。" >&2
  exit 1
fi
if ! effective_fragment_is_owned; then
  echo "::error:: xray_effective_unit_not_owned" >&2
  echo "当前生效的 Xray unit 不来自 ${SERVICE_FILE}，拒绝覆盖。" >&2
  exit 1
fi
if SHADOWED_UNIT="$(find_shadowed_unit)"; then
  echo "::error:: unmanaged_shadowed_xray_unit path=${SHADOWED_UNIT}" >&2
  echo "检测到非 V-Swift 的同名 Xray unit，拒绝用 /etc override 接管。" >&2
  exit 1
fi

if [[ -f "${MARKER_FILE}" ]]; then
  if [[ "$(stat -c %h "${MARKER_FILE}")" != "1" || "$(stat -c %u "${MARKER_FILE}")" != "0" ]] ||
    ! cmp -s "${MARKER_FILE}" <(printf '%s\n' 'managed-by=v-swift'); then
    echo "::error:: invalid_xray_ownership_marker" >&2
    exit 1
  fi
  if systemctl cat xray.service >/dev/null 2>&1 && [[ ! -f "${SERVICE_FILE}" ]]; then
    echo "::error:: xray_unit_moved_outside_v_swift_ownership" >&2
    exit 1
  fi
  if [[ -f "${SERVICE_FILE}" ]] && ! unit_matches_v_swift; then
    echo "::error:: managed_xray_unit_modified" >&2
    exit 1
  fi
  if [[ -f "${CONFIG_FILE}" ]] && ! config_matches_local_record; then
    echo "::error:: managed_xray_config_no_longer_matches_local_node" >&2
    echo "远端 Xray 配置与本地节点凭据不一致，拒绝覆盖可能已被外部接管的服务。" >&2
    exit 1
  fi
else
  if systemctl cat xray.service >/dev/null 2>&1 || [[ -e "${SERVICE_FILE}" || -e "${CONFIG_FILE}" ]]; then
    if legacy_install_matches_local_record; then
      echo "检测到与本地旧节点凭据一致的早期 V-Swift Xray 配置，正在补建所有权标记。"
    else
      echo "::error:: unmanaged_xray_detected" >&2
      echo "目标机已有非 V-Swift 管理的 Xray 服务或配置；为避免覆盖现有节点，本次部署已拒绝。" >&2
      exit 1
    fi
  fi
  install -d -m 700 "${MARKER_DIR}"
  MARKER_TMP="$(mktemp "${MARKER_FILE}.tmp.XXXXXX")"
  printf '%s\n' 'managed-by=v-swift' > "${MARKER_TMP}"
  chmod 600 "${MARKER_TMP}"
  mv -f "${MARKER_TMP}" "${MARKER_FILE}"
  MARKER_TMP=""
fi

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
  RETRY_DELAYS=(3 10 30)
  for attempt in 1 2 3; do
    echo "下载尝试 ${attempt}/3..."
    if download_with_heartbeat "${DOWNLOAD_URL}" "${TMP_DIR}/${ASSET}"; then
      DOWNLOADED=true
      break
    fi
    if [[ ${attempt} -lt 3 ]]; then
      delay="${RETRY_DELAYS[$((attempt - 1))]}"
      echo "下载失败，等待 ${delay} 秒后重试..."
      rm -f "${TMP_DIR}/${ASSET}"
      sleep "${delay}"
    fi
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
UNIT_TMP="$(mktemp "${SERVICE_FILE}.tmp.XXXXXX")"
expected_service_unit > "${UNIT_TMP}"
chmod 644 "${UNIT_TMP}"
mv -f "${UNIT_TMP}" "${SERVICE_FILE}"
UNIT_TMP=""

systemctl daemon-reload
echo "Xray 安装完成（未启动，等待配置）。"
trap - EXIT
