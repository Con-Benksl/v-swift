#!/usr/bin/env bash
set -euo pipefail

PROTO="${1:-}"
PORT="${2:-}"

if [[ -z "${PROTO}" || -z "${PORT}" ]]; then
  echo "::error:: missing_arguments usage: setup_firewall.sh <tcp|udp|both> <port>"
  exit 1
fi

if ! [[ "${PORT}" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  echo "::error:: invalid_port port=${PORT}"
  exit 1
fi

add_ufw_rule() {
  local proto="$1" port="$2"
  echo "正在添加 UFW 规则：${port}/${proto}..."
  ufw allow "${port}/${proto}"
}

add_iptables_rule() {
  local proto="$1" port="$2"
  if ! iptables -C INPUT -p "${proto}" --dport "${port}" -j ACCEPT 2>/dev/null; then
    echo "正在添加 iptables 规则：${proto} ${port}..."
    iptables -I INPUT -p "${proto}" --dport "${port}" -j ACCEPT
  else
    echo "iptables 规则已存在，跳过。"
  fi
  if command -v netfilter-persistent &>/dev/null; then
    netfilter-persistent save || true
  fi
}

add_nft_rule() {
  local proto="$1" port="$2"
  echo "正在添加 nftables 规则：${proto} ${port}..."
  nft list table inet filter >/dev/null 2>&1 || nft add table inet filter
  nft list chain inet filter input >/dev/null 2>&1 || \
    nft add chain inet filter input '{ type filter hook input priority 0 ; policy accept; }'
  nft add rule inet filter input "${proto}" dport "${port}" accept || true
}

detect_ssh_port() {
  if [[ -n "${SSH_CONNECTION:-}" ]]; then
    echo "${SSH_CONNECTION##* }"
    return
  fi
  local cfg_port
  cfg_port="$(awk '/^[[:space:]]*Port[[:space:]]+/ {print $2; exit}' /etc/ssh/sshd_config 2>/dev/null || true)"
  echo "${cfg_port:-22}"
}

try_install_iptables() {
  echo "未发现防火墙工具，尝试通过 apt 安装 iptables..."
  if command -v apt-get &>/dev/null; then
    DEBIAN_FRONTEND=noninteractive apt-get install -yq iptables 2>&1 || true
  fi
}

apply_rules() {
  local proto="$1" port="$2"
  if command -v ufw &>/dev/null; then
    add_ufw_rule "${proto}" "${port}"
    if ! ufw status | grep -q "Status: active"; then
      local ssh_port
      ssh_port="$(detect_ssh_port)"
      echo "检测到 SSH 端口 ${ssh_port}，启用 UFW 前先放行以避免被锁死。"
      ufw allow "${ssh_port}/tcp"
      ufw --force enable
    fi
    return
  fi

  if ! command -v iptables &>/dev/null; then
    try_install_iptables
  fi

  if command -v iptables &>/dev/null; then
    add_iptables_rule "${proto}" "${port}"
    return
  fi

  if command -v nft &>/dev/null; then
    add_nft_rule "${proto}" "${port}"
    return
  fi

  echo "警告：未检测到 ufw / iptables / nft，跳过防火墙设置。"
  echo "提示：大多数 VPS 厂商默认放行所有入站流量，节点应可正常访问；如需自行加规则请手动放行 ${port}/${proto}。"
}

case "${PROTO}" in
  tcp|udp)
    apply_rules "${PROTO}" "${PORT}"
    ;;
  both)
    apply_rules tcp "${PORT}"
    apply_rules udp "${PORT}"
    ;;
  *)
    echo "::error:: invalid_proto proto=${PROTO}"
    exit 1
    ;;
esac

echo "防火墙规则设置完成。"

echo "--- 当前生效的防火墙策略（诊断用）---"
if command -v ufw &>/dev/null; then
  ufw status verbose 2>&1 | head -20 || true
fi
if command -v iptables &>/dev/null; then
  echo "[iptables INPUT]"
  iptables -S INPUT 2>&1 | head -20 || true
fi
if command -v nft &>/dev/null; then
  echo "[nftables ruleset]"
  nft list ruleset 2>&1 | head -30 || true
fi
echo "--- 诊断结束 ---"
