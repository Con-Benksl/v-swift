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
  if command -v ip6tables &>/dev/null; then
    if ! ip6tables -C INPUT -p "${proto}" --dport "${port}" -j ACCEPT 2>/dev/null; then
      echo "正在添加 ip6tables 规则：${proto} ${port}..."
      ip6tables -I INPUT -p "${proto}" --dport "${port}" -j ACCEPT
    else
      echo "ip6tables 规则已存在，跳过。"
    fi
  else
    echo "未检测到 ip6tables；若 VPS 通过 IPv6 对外服务，请手动确认 IPv6 入站策略。"
  fi
  if command -v netfilter-persistent &>/dev/null; then
    echo "正在持久化 netfilter 规则..."
    netfilter-persistent save
  fi
}

add_nft_rule() {
  local proto="$1" port="$2"
  if ! nft list chain inet filter input >/dev/null 2>&1; then
    local ruleset
    if ! ruleset="$(nft list ruleset 2>/dev/null)"; then
      echo "::error:: unable_to_inspect_nftables_ruleset" >&2
      return 1
    fi
    if ! grep -q '[^[:space:]]' <<<"${ruleset}"; then
      echo "nftables 规则集为空，当前没有主机级过滤规则，无需额外放行。"
      return 0
    fi
    echo "检测到 nftables，但不存在既有 inet/filter/input 链；为避免创建改变全局策略的新基链，本次未自动修改 nftables。"
    echo "请在现有规则集中提供可验证的 inet/filter/input 链并放行 ${port}/${proto} 后重试；客户端不会猜测修改自定义链。"
    echo "::error:: unsupported_nftables_input_chain" >&2
    return 2
  fi

  local rules
  rules="$(nft list chain inet filter input 2>/dev/null)"
  if grep -Eq "${proto}[[:space:]]+dport[[:space:]]+${port}([^0-9]|$).*accept" <<<"${rules}"; then
    echo "nftables 规则已存在，跳过。"
    return 0
  fi

  echo "正在添加 nftables 规则：${proto} ${port}..."
  nft add rule inet filter input "${proto}" dport "${port}" accept comment "v-swift:${proto}:${port}"
}

apply_rules() {
  local proto="$1" port="$2"
  if command -v ufw &>/dev/null; then
    if ufw status | grep -q "Status: active"; then
      add_ufw_rule "${proto}" "${port}"
      return
    else
      echo "检测到 UFW 已安装但未启用；为避免改变现有 VPS 防火墙策略，本次不自动启用 UFW。"
      echo "继续检查当前正在使用的 iptables / nftables 规则。"
    fi
  fi

  if command -v iptables &>/dev/null; then
    add_iptables_rule "${proto}" "${port}"
    return
  fi

  if command -v nft &>/dev/null; then
    local nft_status=0
    add_nft_rule "${proto}" "${port}" || nft_status=$?
    if (( nft_status == 0 )); then
      return
    fi
    if (( nft_status != 2 )); then
      return "${nft_status}"
    fi
    return 2
  fi

  echo "警告：未检测到正在使用的 ufw / iptables / nft 输入链，跳过防火墙修改。"
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

echo "防火墙规则检查完成。"

echo "--- 当前生效的防火墙策略（诊断用）---"
if command -v ufw &>/dev/null; then
  ufw status verbose 2>&1 | head -20 || true
fi
if command -v iptables &>/dev/null; then
  echo "[iptables INPUT]"
  iptables -S INPUT 2>&1 | head -20 || true
fi
if command -v ip6tables &>/dev/null; then
  echo "[ip6tables INPUT]"
  ip6tables -S INPUT 2>&1 | head -20 || true
fi
if command -v nft &>/dev/null; then
  echo "[nftables ruleset]"
  nft list ruleset 2>&1 | head -30 || true
fi
echo "--- 诊断结束 ---"
