#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-}"
PROTOCOL="${2:-}"
ATTEMPT_ID="${3:-}"
LEGACY_OWNERSHIP_HASH="${4:-}"

case "${ACTION}" in
  check|begin|rollback|finalize) ;;
  *)
    echo "::error:: invalid_transaction_action" >&2
    exit 1
    ;;
esac

if ! [[ "${ATTEMPT_ID}" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
  echo "::error:: invalid_deployment_attempt_id" >&2
  exit 1
fi
if [[ -n "${LEGACY_OWNERSHIP_HASH}" ]] && ! [[ "${LEGACY_OWNERSHIP_HASH}" =~ ^[0-9a-f]{64}$ ]]; then
  echo "::error:: invalid_legacy_ownership_hash" >&2
  exit 1
fi
if [[ "$(id -u)" != "0" ]]; then
  echo "::error:: deployment_transaction_requires_root" >&2
  exit 1
fi
if [[ "$(uname -s)" != "Linux" ]]; then
  echo "::error:: unsupported_transaction_operating_system" >&2
  exit 1
fi

for required_command in awk basename cat chmod chown cmp dirname find flock id install ln mkdir mktemp mv rmdir sed sha256sum stat systemctl uname unlink; do
  if ! command -v "${required_command}" >/dev/null 2>&1; then
    echo "::error:: missing_transaction_capability command=${required_command}" >&2
    exit 1
  fi
done
if ! systemctl --version >/dev/null 2>&1; then
  echo "::error:: systemd_unavailable" >&2
  exit 1
fi
SYSTEMD_MANAGER_VERSION="$(systemctl show --property=Version --value 2>/dev/null || true)"
if [[ -z "${SYSTEMD_MANAGER_VERSION}" ]]; then
  echo "::error:: systemd_manager_unreachable" >&2
  exit 1
fi
if ! stat -c '%u:%g:%a' / >/dev/null 2>&1; then
  echo "::error:: gnu_stat_capability_unavailable" >&2
  exit 1
fi
MV_HELP="$(mv --help 2>&1)"
if [[ "${MV_HELP}" != *"-T, --no-target-directory"* ]]; then
  echo "::error:: atomic_rename_capability_unavailable" >&2
  exit 1
fi

STATE_ROOT="/var/lib/v-swift"
TRANSACTION_ROOT="${STATE_ROOT}/deploy-transactions"
TRANSACTION_DIR="${TRANSACTION_ROOT}/${ATTEMPT_ID}"
STAGING_DIR="${TRANSACTION_ROOT}/.${ATTEMPT_ID}.tmp"
CLEANUP_DIR="${TRANSACTION_ROOT}/.${ATTEMPT_ID}.cleanup"
STATE_FILE="${TRANSACTION_DIR}/state"
ROLLBACK_COMPLETE_FILE="${TRANSACTION_DIR}/rollback-complete"
LEASE_ROOT="${STATE_ROOT}/deploy-locks"
LEASE_FILE="${LEASE_ROOT}/${PROTOCOL}.lease"
CLAIM_FILE="${LEASE_ROOT}/.${PROTOCOL}.${ATTEMPT_ID}.claim"
GUARD_FILE="${LEASE_ROOT}/${PROTOCOL}.guard"

BACKUP_NAMES=()
ORIGINAL_PATHS=()
PROTECTED_DIRS=("${STATE_ROOT}" "${TRANSACTION_ROOT}" "${LEASE_ROOT}")
SHADOWED_UNIT_PATHS=()
DROPIN_DIR_NAMES=()

case "${PROTOCOL}" in
  vless-reality)
    SERVICE_NAME="xray.service"
    SERVICE_FILE="/etc/systemd/system/xray.service"
    CONFIG_FILE="/usr/local/etc/xray/config.json"
    MARKER_FILE="/var/lib/v-swift/managed/xray"
    BACKUP_NAMES=(service-unit config marker)
    ORIGINAL_PATHS=("${SERVICE_FILE}" "${CONFIG_FILE}" "${MARKER_FILE}")
    PROTECTED_DIRS+=("/etc/systemd/system" "/usr/local/etc/xray" "/var/lib/v-swift/managed")
    DROPIN_DIR_NAMES=(xray.service.d service.d)
    SHADOWED_UNIT_PATHS=(
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
    CONFIG_FILE="/etc/hysteria/config.yaml"
    MARKER_FILE="/var/lib/v-swift/managed/hysteria2"
    BACKUP_NAMES=(service-unit config certificate private-key marker)
    ORIGINAL_PATHS=(
      "${SERVICE_FILE}"
      "${CONFIG_FILE}"
      "/etc/hysteria/server.crt"
      "/etc/hysteria/server.key"
      "${MARKER_FILE}"
    )
    PROTECTED_DIRS+=("/etc/systemd/system" "/etc/hysteria" "/var/lib/v-swift/managed")
    DROPIN_DIR_NAMES=(hysteria-server.service.d hysteria-.service.d service.d)
    SHADOWED_UNIT_PATHS=(
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
    echo "::error:: invalid_transaction_protocol" >&2
    exit 1
    ;;
esac

expected_service_unit() {
  case "${PROTOCOL}" in
    vless-reality)
      cat <<'SVCEOF'
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
      cat <<'SVCEOF'
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

fail_unsafe_path() {
  echo "::error:: unsafe_deployment_transaction_path path=$1" >&2
  exit 1
}

assert_directory_or_absent() {
  local path="$1" mode
  if [[ -L "${path}" ]] || { [[ -e "${path}" ]] && [[ ! -d "${path}" ]]; }; then
    fail_unsafe_path "${path}"
  fi
  if [[ -d "${path}" ]]; then
    mode="$(stat -c %a "${path}")"
    if [[ "$(stat -c %u "${path}")" != "0" ]] || (( (8#${mode} & 0022) != 0 )); then
      fail_unsafe_path "${path}"
    fi
  fi
}

assert_regular_root_file() {
  local path="$1" mode
  if [[ -L "${path}" || ! -f "${path}" ]] ||
    [[ "$(stat -c %u "${path}")" != "0" ]] ||
    [[ "$(stat -c %h "${path}")" != "1" ]]; then
    fail_unsafe_path "${path}"
  fi
  mode="$(stat -c %a "${path}")"
  if (( (8#${mode} & 0022) != 0 )); then
    fail_unsafe_path "${path}"
  fi
}

assert_regular_root_lease_file() {
  local path="$1" mode
  if [[ -L "${path}" || ! -f "${path}" ]] || [[ "$(stat -c %u "${path}")" != "0" ]]; then
    fail_unsafe_path "${path}"
  fi
  mode="$(stat -c %a "${path}")"
  if (( (8#${mode} & 0077) != 0 )); then
    fail_unsafe_path "${path}"
  fi
}

assert_managed_paths_safe() {
  local path
  for path in "${PROTECTED_DIRS[@]}"; do
    assert_directory_or_absent "${path}"
  done
  for path in "${ORIGINAL_PATHS[@]}"; do
    if [[ -e "${path}" || -L "${path}" ]]; then
      assert_regular_root_file "${path}"
    fi
  done
}

prepare_state_roots() {
  assert_directory_or_absent "${STATE_ROOT}"
  install -d -m 700 "${STATE_ROOT}"
  assert_directory_or_absent "${TRANSACTION_ROOT}"
  assert_directory_or_absent "${LEASE_ROOT}"
  install -d -m 700 "${TRANSACTION_ROOT}" "${LEASE_ROOT}"
  assert_directory_or_absent "${TRANSACTION_ROOT}"
  assert_directory_or_absent "${LEASE_ROOT}"
}

unit_matches_v_swift() {
  [[ -f "${SERVICE_FILE}" ]] && cmp -s "${SERVICE_FILE}" <(expected_service_unit)
}

marker_is_valid() {
  [[ -f "${MARKER_FILE}" ]] &&
    [[ ! -L "${MARKER_FILE}" ]] &&
    [[ "$(stat -c %u "${MARKER_FILE}")" == "0" ]] &&
    [[ "$(stat -c %h "${MARKER_FILE}")" == "1" ]] &&
    cmp -s "${MARKER_FILE}" <(printf '%s\n' 'managed-by=v-swift')
}

config_matches_local_record() {
  [[ -n "${LEGACY_OWNERSHIP_HASH}" && -f "${CONFIG_FILE}" && ! -L "${CONFIG_FILE}" ]] || return 1
  local current_secret current_hash
  case "${PROTOCOL}" in
    vless-reality)
      if ! command -v jq >/dev/null 2>&1; then
        echo "::error:: missing_transaction_capability command=jq" >&2
        return 1
      fi
      current_secret="$(jq -r '[.inbounds[]? | select(.protocol == "vless") | .settings.clients[0].id // empty][0] // empty' "${CONFIG_FILE}" 2>/dev/null)"
      ;;
    hysteria2)
      current_secret="$(sed -n 's/^[[:space:]]*password:[[:space:]]*"\(.*\)"[[:space:]]*$/\1/p' "${CONFIG_FILE}" | sed -n '1p')"
      ;;
  esac
  [[ -n "${current_secret}" ]] || return 1
  current_hash="$(printf '%s' "${current_secret}" | sha256sum | awk '{print $1}')"
  [[ "${current_hash}" == "${LEGACY_OWNERSHIP_HASH}" ]]
}

has_on_disk_dropins() {
  local root name dropin_dir
  for root in /etc/systemd/system /run/systemd/system /usr/local/lib/systemd/system /usr/lib/systemd/system /lib/systemd/system; do
    for name in "${DROPIN_DIR_NAMES[@]}"; do
      dropin_dir="${root}/${name}"
      if [[ -L "${dropin_dir}" ]] ||
        { [[ -d "${dropin_dir}" ]] && [[ -n "$(find "${dropin_dir}" -mindepth 1 -maxdepth 1 -name '*.conf' \( -type f -o -type l \) -print -quit 2>/dev/null)" ]]; }; then
        return 0
      fi
    done
  done
  return 1
}

find_shadowed_unit() {
  local candidate
  for candidate in "${SHADOWED_UNIT_PATHS[@]}"; do
    if [[ -e "${candidate}" || -L "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done
  return 1
}

systemctl_property() {
  local property="$1" value
  if ! value="$(systemctl show -p "${property}" --value "${SERVICE_NAME}" 2>/dev/null)"; then
    echo "::error:: systemd_query_failed service=${SERVICE_NAME} property=${property}" >&2
    exit 1
  fi
  printf '%s' "${value}"
}

service_is_absent() {
  local load_state active_state fragment dropins
  load_state="$(systemctl_property LoadState)"
  active_state="$(systemctl_property ActiveState)"
  fragment="$(systemctl_property FragmentPath)"
  dropins="$(systemctl_property DropInPaths)"
  [[ -z "${fragment}" && -z "${dropins}" ]] || return 1
  [[ -z "${load_state}" || "${load_state}" == "not-found" ]] || return 1
  [[ -z "${active_state}" || "${active_state}" == "inactive" || "${active_state}" == "failed" ]] || return 1
  if systemctl cat "${SERVICE_NAME}" >/dev/null 2>&1; then
    return 1
  fi
  ! systemctl is-enabled --quiet "${SERVICE_NAME}"
}

ownership_preflight() {
  assert_managed_paths_safe

  local effective_fragment effective_dropins shadowed path any_managed_path=0
  effective_fragment="$(systemctl_property FragmentPath)"
  effective_dropins="$(systemctl_property DropInPaths)"
  if has_on_disk_dropins || [[ -n "${effective_dropins}" ]]; then
    echo "::error:: deployment_transaction_refused_dropins service=${SERVICE_NAME}" >&2
    exit 1
  fi
  if shadowed="$(find_shadowed_unit)"; then
    echo "::error:: deployment_transaction_refused_shadowed_unit path=${shadowed}" >&2
    exit 1
  fi

  for path in "${ORIGINAL_PATHS[@]}"; do
    if [[ -e "${path}" || -L "${path}" ]]; then
      any_managed_path=1
      break
    fi
  done

  if (( any_managed_path == 0 )) && service_is_absent; then
    return 0
  fi

  if [[ -z "${LEGACY_OWNERSHIP_HASH}" ]]; then
    echo "::error:: existing_deployment_requires_ownership_hash service=${SERVICE_NAME}" >&2
    exit 1
  fi
  if [[ "${effective_fragment}" != "${SERVICE_FILE}" ]]; then
    echo "::error:: deployment_transaction_refused_unowned_unit fragment=${effective_fragment:-none}" >&2
    exit 1
  fi
  if ! unit_matches_v_swift; then
    echo "::error:: deployment_transaction_refused_modified_unit service=${SERVICE_NAME}" >&2
    exit 1
  fi
  if ! config_matches_local_record; then
    echo "::error:: deployment_transaction_refused_unowned_config service=${SERVICE_NAME}" >&2
    exit 1
  fi
  if [[ -e "${MARKER_FILE}" || -L "${MARKER_FILE}" ]] && ! marker_is_valid; then
    echo "::error:: invalid_deployment_ownership_marker service=${SERVICE_NAME}" >&2
    exit 1
  fi
}

expected_claim() {
  printf 'protocol=%s\nattempt_id=%s\n' "${PROTOCOL}" "${ATTEMPT_ID}"
}

validate_claim_file() {
  local path="$1"
  assert_regular_root_lease_file "${path}"
  if ! cmp -s "${path}" <(expected_claim); then
    echo "::error:: deployment_transaction_lease_owned_by_another_attempt protocol=${PROTOCOL}" >&2
    exit 1
  fi
}

cleanup_own_claim() {
  if [[ -e "${CLAIM_FILE}" || -L "${CLAIM_FILE}" ]]; then
    validate_claim_file "${CLAIM_FILE}"
    unlink "${CLAIM_FILE}"
  fi
}

ensure_claim_file() {
  if [[ -e "${CLAIM_FILE}" || -L "${CLAIM_FILE}" ]]; then
    validate_claim_file "${CLAIM_FILE}"
    return
  fi

  local claim_tmp
  claim_tmp="$(mktemp "${CLAIM_FILE}.tmp.XXXXXX")"
  expected_claim >"${claim_tmp}"
  chmod 600 "${claim_tmp}"
  chown 0:0 "${claim_tmp}"
  if ! ln "${claim_tmp}" "${CLAIM_FILE}" 2>/dev/null; then
    unlink "${claim_tmp}"
    validate_claim_file "${CLAIM_FILE}"
    return
  fi
  unlink "${claim_tmp}"
  validate_claim_file "${CLAIM_FILE}"
}

acquire_lease() {
  ensure_claim_file
  if [[ -e "${LEASE_FILE}" || -L "${LEASE_FILE}" ]]; then
    assert_regular_root_lease_file "${LEASE_FILE}"
    if cmp -s "${LEASE_FILE}" <(expected_claim); then
      return
    fi
    cleanup_own_claim
    echo "::error:: deployment_transaction_lease_owned_by_another_attempt protocol=${PROTOCOL}" >&2
    exit 1
  fi
  if ! ln "${CLAIM_FILE}" "${LEASE_FILE}" 2>/dev/null; then
    assert_regular_root_lease_file "${LEASE_FILE}"
    if cmp -s "${LEASE_FILE}" <(expected_claim); then
      return
    fi
    cleanup_own_claim
    echo "::error:: deployment_transaction_lease_owned_by_another_attempt protocol=${PROTOCOL}" >&2
    exit 1
  fi
  validate_claim_file "${LEASE_FILE}"
}

check_no_active_lease() {
  assert_directory_or_absent "${STATE_ROOT}"
  assert_directory_or_absent "${LEASE_ROOT}"
  if [[ -e "${LEASE_FILE}" || -L "${LEASE_FILE}" ]]; then
    assert_regular_root_lease_file "${LEASE_FILE}"
    echo "::error:: deployment_transaction_lease_already_active protocol=${PROTOCOL}" >&2
    exit 1
  fi
}

assert_lease_owned() {
  if [[ ! -e "${LEASE_FILE}" && ! -L "${LEASE_FILE}" ]]; then
    echo "::error:: deployment_transaction_lease_missing protocol=${PROTOCOL}" >&2
    exit 1
  fi
  validate_claim_file "${LEASE_FILE}"
}

release_lease() {
  if [[ -e "${LEASE_FILE}" || -L "${LEASE_FILE}" ]]; then
    validate_claim_file "${LEASE_FILE}"
  fi
  if [[ -e "${CLAIM_FILE}" || -L "${CLAIM_FILE}" ]]; then
    validate_claim_file "${CLAIM_FILE}"
  fi
  if [[ -e "${LEASE_FILE}" || -L "${LEASE_FILE}" ]]; then
    unlink "${LEASE_FILE}"
  fi
  if [[ -e "${CLAIM_FILE}" || -L "${CLAIM_FILE}" ]]; then
    unlink "${CLAIM_FILE}"
  fi
}

# Once an attempt has no published transaction directory, its cleanup is
# isolated by ATTEMPT_ID. A newer attempt may already own the protocol lease;
# leave that lease untouched while removing only this attempt's stale claim.
release_lease_if_owned_or_cleanup_claim() {
  local owns_lease=0
  if [[ -e "${LEASE_FILE}" || -L "${LEASE_FILE}" ]]; then
    assert_regular_root_lease_file "${LEASE_FILE}"
    if cmp -s "${LEASE_FILE}" <(expected_claim); then
      owns_lease=1
    fi
  fi
  if (( owns_lease == 1 )); then
    if [[ -e "${CLAIM_FILE}" || -L "${CLAIM_FILE}" ]]; then
      validate_claim_file "${CLAIM_FILE}"
    fi
    unlink "${LEASE_FILE}"
  fi
  cleanup_own_claim
}

acquire_operation_guard() {
  local guard_tmp
  if [[ ! -e "${GUARD_FILE}" && ! -L "${GUARD_FILE}" ]]; then
    guard_tmp="$(mktemp "${GUARD_FILE}.tmp.XXXXXX")"
    chmod 600 "${guard_tmp}"
    chown 0:0 "${guard_tmp}"
    if ! ln "${guard_tmp}" "${GUARD_FILE}" 2>/dev/null; then
      unlink "${guard_tmp}"
    else
      unlink "${guard_tmp}"
    fi
  fi
  assert_regular_root_file "${GUARD_FILE}"
  exec 9<>"${GUARD_FILE}"
  if ! flock -n 9; then
    echo "::error:: deployment_transaction_operation_in_progress protocol=${PROTOCOL}" >&2
    exit 1
  fi
}

is_known_transaction_entry() {
  local name="$1" known
  case "${name}" in
    state|state.tmp|rollback-complete|rollback-complete.tmp|rollback-complete.tmp.[A-Za-z0-9]*) return 0 ;;
  esac
  for known in "${BACKUP_NAMES[@]}"; do
    [[ "${name}" == "${known}" ]] && return 0
  done
  return 1
}

cleanup_known_transaction_dir() {
  local directory="$1" path name cleanup_failed=0
  if [[ ! -e "${directory}" && ! -L "${directory}" ]]; then
    return 0
  fi
  assert_directory_or_absent "${directory}"
  while IFS= read -r -d '' path; do
    name="${path##*/}"
    if ! is_known_transaction_entry "${name}"; then
      echo "::warning:: unknown_transaction_cleanup_entry path=${path}" >&2
      cleanup_failed=1
      continue
    fi
    if [[ -f "${path}" && ! -L "${path}" && "$(stat -c %u "${path}")" == "0" && "$(stat -c %h "${path}")" == "1" ]]; then
      unlink "${path}" || cleanup_failed=1
    else
      echo "::warning:: unsafe_transaction_cleanup_entry path=${path}" >&2
      cleanup_failed=1
    fi
  done < <(find "${directory}" -mindepth 1 -maxdepth 1 -print0)
  rmdir "${directory}" 2>/dev/null || cleanup_failed=1
  return "${cleanup_failed}"
}

state_value_from() {
  local state_file="$1" key="$2"
  sed -n "s/^${key}=//p" "${state_file}"
}

require_single_state_value() {
  local key="$1" pattern="$2" value count
  count="$(sed -n "s/^${key}=//p" "${STATE_FILE}" | awk 'END {print NR}')"
  if [[ "${count}" != "1" ]]; then
    echo "::error:: invalid_deployment_transaction_state field=${key}" >&2
    exit 1
  fi
  value="$(state_value_from "${STATE_FILE}" "${key}")"
  if ! [[ "${value}" =~ ${pattern} ]]; then
    echo "::error:: invalid_deployment_transaction_state field=${key}" >&2
    exit 1
  fi
}

state_value() {
  state_value_from "${STATE_FILE}" "$1"
}

validate_saved_transaction() {
  assert_directory_or_absent "${STATE_ROOT}"
  assert_directory_or_absent "${TRANSACTION_ROOT}"
  assert_directory_or_absent "${TRANSACTION_DIR}"
  if [[ ! -d "${TRANSACTION_DIR}" || ! -f "${STATE_FILE}" || -L "${STATE_FILE}" ]]; then
    echo "::error:: incomplete_deployment_transaction attempt=${ATTEMPT_ID}" >&2
    exit 1
  fi
  if [[ "$(stat -c %u "${TRANSACTION_DIR}")" != "0" || "$(stat -c %u "${STATE_FILE}")" != "0" || "$(stat -c %h "${STATE_FILE}")" != "1" ]]; then
    echo "::error:: unsafe_deployment_transaction_ownership attempt=${ATTEMPT_ID}" >&2
    exit 1
  fi
  require_single_state_value protocol '^(vless-reality|hysteria2)$'
  require_single_state_value attempt_id '^[0-9a-f-]{36}$'
  require_single_state_value was_enabled '^[01]$'
  require_single_state_value was_active '^[01]$'
  if [[ "$(state_value protocol)" != "${PROTOCOL}" || "$(state_value attempt_id)" != "${ATTEMPT_ID}" ]]; then
    echo "::error:: deployment_transaction_identity_mismatch attempt=${ATTEMPT_ID}" >&2
    exit 1
  fi

  local name had_file
  for name in "${BACKUP_NAMES[@]}"; do
    require_single_state_value "had_${name}" '^[01]$'
    had_file="$(state_value "had_${name}")"
    if [[ "${had_file}" == "1" ]]; then
      require_single_state_value "uid_${name}" '^[0-9]+$'
      require_single_state_value "gid_${name}" '^[0-9]+$'
      require_single_state_value "mode_${name}" '^[0-7]{3,4}$'
      assert_regular_root_file "${TRANSACTION_DIR}/${name}"
    elif [[ -e "${TRANSACTION_DIR}/${name}" || -L "${TRANSACTION_DIR}/${name}" ]]; then
      echo "::error:: unexpected_deployment_backup path=${TRANSACTION_DIR}/${name}" >&2
      exit 1
    fi
  done
}

snapshot_managed_paths() {
  local index name path had_file uid gid mode active_state unit_file_state was_active was_enabled
  local state_tmp="${STAGING_DIR}/state.tmp"
  local staging_state="${STAGING_DIR}/state"

  active_state="$(systemctl_property ActiveState)"
  case "${active_state}" in
    active) was_active=1 ;;
    inactive|failed|"") was_active=0 ;;
    *)
      echo "::error:: deployment_transaction_service_state_not_stable service=${SERVICE_NAME} state=${active_state}" >&2
      exit 1
      ;;
  esac
  unit_file_state="$(systemctl_property UnitFileState)"
  if systemctl is-enabled --quiet "${SERVICE_NAME}"; then
    was_enabled=1
  else
    case "${unit_file_state}" in
      enabled|enabled-runtime|linked|linked-runtime|alias)
        echo "::error:: deployment_transaction_enabled_state_query_inconsistent service=${SERVICE_NAME}" >&2
        exit 1
        ;;
      *) was_enabled=0 ;;
    esac
  fi

  {
    printf 'protocol=%s\n' "${PROTOCOL}"
    printf 'attempt_id=%s\n' "${ATTEMPT_ID}"
    printf 'was_enabled=%s\n' "${was_enabled}"
    printf 'was_active=%s\n' "${was_active}"
    for index in "${!BACKUP_NAMES[@]}"; do
      name="${BACKUP_NAMES[${index}]}"
      path="${ORIGINAL_PATHS[${index}]}"
      had_file=0
      if [[ -e "${path}" || -L "${path}" ]]; then
        assert_regular_root_file "${path}"
        uid="$(stat -c %u "${path}")"
        gid="$(stat -c %g "${path}")"
        mode="$(stat -c %a "${path}")"
        install -o 0 -g 0 -m 600 -- "${path}" "${STAGING_DIR}/${name}"
        had_file=1
        printf 'uid_%s=%s\n' "${name}" "${uid}"
        printf 'gid_%s=%s\n' "${name}" "${gid}"
        printf 'mode_%s=%s\n' "${name}" "${mode}"
      fi
      printf 'had_%s=%s\n' "${name}" "${had_file}"
    done
  } >"${state_tmp}"
  chmod 600 "${state_tmp}"
  chown 0:0 "${state_tmp}"
  mv -T "${state_tmp}" "${staging_state}"
}

validate_staging_snapshot() {
  local staging_state="${STAGING_DIR}/state" index name path had_file
  assert_regular_root_file "${staging_state}"
  for index in "${!BACKUP_NAMES[@]}"; do
    name="${BACKUP_NAMES[${index}]}"
    path="${ORIGINAL_PATHS[${index}]}"
    had_file="$(state_value_from "${staging_state}" "had_${name}")"
    case "${had_file}" in
      1)
        assert_regular_root_file "${path}"
        assert_regular_root_file "${STAGING_DIR}/${name}"
        if ! cmp -s "${path}" "${STAGING_DIR}/${name}" ||
          [[ "$(stat -c %u "${path}")" != "$(state_value_from "${staging_state}" "uid_${name}")" ]] ||
          [[ "$(stat -c %g "${path}")" != "$(state_value_from "${staging_state}" "gid_${name}")" ]] ||
          [[ "$(stat -c %a "${path}")" != "$(state_value_from "${staging_state}" "mode_${name}")" ]]; then
          echo "::error:: deployment_snapshot_changed_during_begin path=${path}" >&2
          exit 1
        fi
        ;;
      0)
        if [[ -e "${path}" || -L "${path}" || -e "${STAGING_DIR}/${name}" || -L "${STAGING_DIR}/${name}" ]]; then
          echo "::error:: deployment_snapshot_changed_during_begin path=${path}" >&2
          exit 1
        fi
        ;;
      *)
        echo "::error:: invalid_deployment_staging_state field=had_${name}" >&2
        exit 1
        ;;
    esac
  done
}

begin_transaction() {
  prepare_state_roots
  acquire_operation_guard
  if [[ -e "${TRANSACTION_DIR}" || -L "${TRANSACTION_DIR}" ]]; then
    validate_saved_transaction
    assert_lease_owned
    echo "远端部署事务 ${ATTEMPT_ID} 已创建。"
    return 0
  fi
  if [[ -e "${CLEANUP_DIR}" || -L "${CLEANUP_DIR}" ]]; then
    echo "::error:: deployment_transaction_already_completed attempt=${ATTEMPT_ID}" >&2
    exit 1
  fi
  if [[ -e "${STAGING_DIR}" || -L "${STAGING_DIR}" ]]; then
    if ! cleanup_known_transaction_dir "${STAGING_DIR}"; then
      echo "::error:: incomplete_staging_cleanup_failed attempt=${ATTEMPT_ID}" >&2
      exit 1
    fi
    release_lease_if_owned_or_cleanup_claim
  fi

  ownership_preflight
  acquire_lease
  local published=0
  cleanup_failed_begin() {
    local exit_code="$?"
    trap - EXIT
    if [[ -d "${TRANSACTION_DIR}" && ! -L "${TRANSACTION_DIR}" ]]; then
      published=1
    fi
    if (( published == 0 )); then
      cleanup_known_transaction_dir "${STAGING_DIR}" || true
      release_lease || true
    fi
    exit "${exit_code}"
  }
  trap cleanup_failed_begin EXIT

  # The lease closes the race between cooperating V-Swift processes. Re-run the
  # ownership check after acquiring it and before reading any service state.
  ownership_preflight
  mkdir -m 700 "${STAGING_DIR}"
  chown 0:0 "${STAGING_DIR}"
  snapshot_managed_paths

  # Detect a non-cooperating change made while the snapshot was being copied.
  ownership_preflight
  validate_staging_snapshot
  if [[ -e "${TRANSACTION_DIR}" || -L "${TRANSACTION_DIR}" ]]; then
    echo "::error:: deployment_transaction_publish_target_exists attempt=${ATTEMPT_ID}" >&2
    exit 1
  fi
  mv -T "${STAGING_DIR}" "${TRANSACTION_DIR}"
  published=1
  trap - EXIT
  echo "已创建可恢复的远端部署事务 ${ATTEMPT_ID}。"
}

validate_current_rollback_target() {
  assert_managed_paths_safe
  local fragment dropins shadowed any_current=0 path
  fragment="$(systemctl_property FragmentPath)"
  dropins="$(systemctl_property DropInPaths)"
  if has_on_disk_dropins || [[ -n "${dropins}" ]]; then
    echo "::error:: deployment_rollback_refused_dropins service=${SERVICE_NAME}" >&2
    exit 1
  fi
  if shadowed="$(find_shadowed_unit)"; then
    echo "::error:: deployment_rollback_refused_shadowed_unit path=${shadowed}" >&2
    exit 1
  fi
  if [[ -n "${fragment}" && "${fragment}" != "${SERVICE_FILE}" ]]; then
    echo "::error:: deployment_rollback_refused_unowned_unit fragment=${fragment}" >&2
    exit 1
  fi
  if [[ -f "${SERVICE_FILE}" ]] && ! unit_matches_v_swift; then
    echo "::error:: deployment_rollback_refused_modified_unit service=${SERVICE_NAME}" >&2
    exit 1
  fi

  for path in "${ORIGINAL_PATHS[@]}"; do
    if [[ -e "${path}" || -L "${path}" ]]; then
      any_current=1
      break
    fi
  done
  if (( any_current == 1 )); then
    if [[ -e "${MARKER_FILE}" || -L "${MARKER_FILE}" ]]; then
      if ! marker_is_valid; then
        echo "::error:: deployment_rollback_refused_invalid_marker service=${SERVICE_NAME}" >&2
        exit 1
      fi
    else
      # A legacy transaction may still be untouched if installation failed
      # before its missing marker was migrated. In that case the old unit and
      # config must still byte-match the immutable snapshot.
      if [[ "$(state_value had_service-unit)" != "1" || "$(state_value had_config)" != "1" ]] ||
        ! cmp -s "${SERVICE_FILE}" "${TRANSACTION_DIR}/service-unit" ||
        ! cmp -s "${CONFIG_FILE}" "${TRANSACTION_DIR}/config"; then
        echo "::error:: deployment_rollback_refused_missing_marker service=${SERVICE_NAME}" >&2
        exit 1
      fi
    fi
  fi
}

restore_file() {
  local name="$1" path="$2" had_file backup parent base restore_tmp uid gid mode
  had_file="$(state_value "had_${name}")"
  backup="${TRANSACTION_DIR}/${name}"
  parent="$(dirname "${path}")"
  base="$(basename "${path}")"
  assert_directory_or_absent "${parent}"

  case "${had_file}" in
    1)
      assert_regular_root_file "${backup}"
      uid="$(state_value "uid_${name}")"
      gid="$(state_value "gid_${name}")"
      mode="$(state_value "mode_${name}")"
      if [[ ! -d "${parent}" ]]; then
        install -d -o 0 -g 0 -m 700 "${parent}"
      fi
      if [[ -e "${path}" || -L "${path}" ]]; then
        assert_regular_root_file "${path}"
      fi
      restore_tmp="${parent}/.${base}.v-swift-rollback-${ATTEMPT_ID}.tmp"
      if [[ -e "${restore_tmp}" || -L "${restore_tmp}" ]]; then
        assert_regular_root_file "${restore_tmp}"
        unlink "${restore_tmp}"
      fi
      install -o 0 -g 0 -m 600 -- "${backup}" "${restore_tmp}"
      chown "${uid}:${gid}" "${restore_tmp}"
      chmod "${mode}" "${restore_tmp}"
      mv -fT "${restore_tmp}" "${path}"
      ;;
    0)
      if [[ -e "${path}" || -L "${path}" ]]; then
        assert_regular_root_file "${path}"
        unlink "${path}"
      fi
      ;;
  esac
}

mark_rollback_complete() {
  if [[ -e "${ROLLBACK_COMPLETE_FILE}" || -L "${ROLLBACK_COMPLETE_FILE}" ]]; then
    assert_regular_root_file "${ROLLBACK_COMPLETE_FILE}"
    if ! cmp -s "${ROLLBACK_COMPLETE_FILE}" <(printf '%s\n' 'rollback-complete'); then
      echo "::error:: invalid_rollback_complete_marker attempt=${ATTEMPT_ID}" >&2
      exit 1
    fi
    return
  fi
  local marker_tmp="${TRANSACTION_DIR}/rollback-complete.tmp"
  if [[ -e "${marker_tmp}" || -L "${marker_tmp}" ]]; then
    assert_regular_root_file "${marker_tmp}"
    unlink "${marker_tmp}"
  fi
  printf '%s\n' 'rollback-complete' >"${marker_tmp}"
  chmod 600 "${marker_tmp}"
  chown 0:0 "${marker_tmp}"
  mv -T "${marker_tmp}" "${ROLLBACK_COMPLETE_FILE}"
}

finish_cleanup_directory() {
  assert_directory_or_absent "${CLEANUP_DIR}"
  release_lease_if_owned_or_cleanup_claim
  if ! cleanup_known_transaction_dir "${CLEANUP_DIR}"; then
    echo "::error:: deployment_transaction_cleanup_incomplete attempt=${ATTEMPT_ID}" >&2
    return 1
  fi
  rmdir "${TRANSACTION_ROOT}" 2>/dev/null || true
}

rollback_transaction() {
  prepare_state_roots
  acquire_operation_guard
  if [[ -e "${CLEANUP_DIR}" || -L "${CLEANUP_DIR}" ]]; then
    finish_cleanup_directory
    echo "远端部署事务 ${ATTEMPT_ID} 已回滚。"
    return 0
  fi
  if [[ ! -e "${TRANSACTION_DIR}" && ! -L "${TRANSACTION_DIR}" ]]; then
    if [[ -e "${STAGING_DIR}" || -L "${STAGING_DIR}" ]]; then
      if ! cleanup_known_transaction_dir "${STAGING_DIR}"; then
        echo "::error:: incomplete_staging_cleanup_failed attempt=${ATTEMPT_ID}" >&2
        exit 1
      fi
    fi
    release_lease_if_owned_or_cleanup_claim
    echo "远端部署事务 ${ATTEMPT_ID} 尚未开始或已回滚。"
    return 0
  fi

  validate_saved_transaction
  assert_lease_owned
  if [[ ! -e "${ROLLBACK_COMPLETE_FILE}" && ! -L "${ROLLBACK_COMPLETE_FILE}" ]]; then
    validate_current_rollback_target
    local current_active_state current_unit_file_state
    current_active_state="$(systemctl_property ActiveState)"
    case "${current_active_state}" in
      active|activating|reloading|deactivating) systemctl stop "${SERVICE_NAME}" >/dev/null ;;
      inactive|failed|"") ;;
      *)
        echo "::error:: deployment_rollback_unknown_active_state service=${SERVICE_NAME} state=${current_active_state}" >&2
        exit 1
        ;;
    esac
    current_unit_file_state="$(systemctl_property UnitFileState)"
    if systemctl is-enabled --quiet "${SERVICE_NAME}"; then
      systemctl disable "${SERVICE_NAME}" >/dev/null
    else
      case "${current_unit_file_state}" in
        enabled|enabled-runtime|linked|linked-runtime|alias)
          echo "::error:: deployment_rollback_enabled_state_query_inconsistent service=${SERVICE_NAME}" >&2
          exit 1
          ;;
      esac
    fi

    local index
    for index in "${!BACKUP_NAMES[@]}"; do
      restore_file "${BACKUP_NAMES[${index}]}" "${ORIGINAL_PATHS[${index}]}"
    done

    systemctl daemon-reload
    if [[ "$(state_value had_service-unit)" == "1" ]]; then
      if [[ "$(state_value was_enabled)" == "1" ]]; then
        systemctl enable "${SERVICE_NAME}" >/dev/null
      else
        systemctl disable "${SERVICE_NAME}" >/dev/null
        if systemctl is-enabled --quiet "${SERVICE_NAME}"; then
          echo "::error:: deployment_rollback_failed_to_restore_disabled_state service=${SERVICE_NAME}" >&2
          exit 1
        fi
      fi
      if [[ "$(state_value was_active)" == "1" ]]; then
        systemctl start "${SERVICE_NAME}"
        systemctl is-active --quiet "${SERVICE_NAME}"
      else
        systemctl stop "${SERVICE_NAME}" >/dev/null
        if systemctl is-active --quiet "${SERVICE_NAME}"; then
          echo "::error:: deployment_rollback_failed_to_restore_inactive_state service=${SERVICE_NAME}" >&2
          exit 1
        fi
      fi
    elif ! service_is_absent; then
      echo "::error:: deployment_rollback_failed_to_restore_absent_service service=${SERVICE_NAME}" >&2
      exit 1
    fi
    mark_rollback_complete
  else
    mark_rollback_complete
  fi

  if [[ -e "${CLEANUP_DIR}" || -L "${CLEANUP_DIR}" ]]; then
    echo "::error:: deployment_transaction_cleanup_target_exists attempt=${ATTEMPT_ID}" >&2
    exit 1
  fi
  mv -T "${TRANSACTION_DIR}" "${CLEANUP_DIR}"
  finish_cleanup_directory
  echo "已回滚远端部署事务 ${ATTEMPT_ID}。"
}

finalize_transaction() {
  prepare_state_roots
  acquire_operation_guard
  if [[ -e "${CLEANUP_DIR}" || -L "${CLEANUP_DIR}" ]]; then
    finish_cleanup_directory
    echo "远端部署事务 ${ATTEMPT_ID} 已完成清理。"
    return 0
  fi
  if [[ ! -e "${TRANSACTION_DIR}" && ! -L "${TRANSACTION_DIR}" ]]; then
    if [[ -e "${STAGING_DIR}" || -L "${STAGING_DIR}" ]]; then
      if ! cleanup_known_transaction_dir "${STAGING_DIR}"; then
        echo "::error:: incomplete_staging_cleanup_failed attempt=${ATTEMPT_ID}" >&2
        exit 1
      fi
    fi
    release_lease_if_owned_or_cleanup_claim
    echo "远端部署事务 ${ATTEMPT_ID} 已完成清理。"
    return 0
  fi

  validate_saved_transaction
  assert_lease_owned
  if [[ -e "${CLEANUP_DIR}" || -L "${CLEANUP_DIR}" ]]; then
    echo "::error:: deployment_transaction_cleanup_target_exists attempt=${ATTEMPT_ID}" >&2
    exit 1
  fi
  mv -T "${TRANSACTION_DIR}" "${CLEANUP_DIR}"
  finish_cleanup_directory
  echo "已提交远端部署事务 ${ATTEMPT_ID}。"
}

case "${ACTION}" in
  check)
    ownership_preflight
    check_no_active_lease
    echo "远端部署事务能力与所有权预检通过。"
    ;;
  begin) begin_transaction ;;
  rollback) rollback_transaction ;;
  finalize) finalize_transaction ;;
esac
