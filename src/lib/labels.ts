/**
 * 展示层文案标签工具。
 *
 * 合并自 `src/pages/NodeList.tsx`、`src/pages/NodeDetail.tsx` 与
 * `src/components/control/ServiceList.tsx` 中各自的本地实现。
 * 注意：`extractPort` 此前在两处页面已漂移（NodeList 返回 `undefined`，
 * NodeDetail 返回 `'未记录'`），现统一返回 `number | undefined`，
 * 兜底文案（如 '未记录' / '端口待确认'）由展示层自行决定。
 */

import { NodeRecord } from '../ipc/types';

/** 已知协议 id → 用户可读名称 的对照表。 */
const PROTOCOL_LABELS: Record<string, string> = {
  'vless-reality': 'VLESS Reality',
  hysteria2: 'Hysteria 2',
};

/**
 * 将协议 id 转换为面向用户的中文/品牌名称。
 * 未知 id 兜底返回原值（不把技术标识误当未知状态展示）。
 *
 * @example
 * protocolLabel('vless-reality'); // 'VLESS Reality'
 * protocolLabel('hysteria2');     // 'Hysteria 2'
 * protocolLabel('trojan');        // 'trojan'（未知 id 原样返回）
 */
export function protocolLabel(protocol: string): string {
  return PROTOCOL_LABELS[protocol] ?? protocol;
}

/**
 * 将节点状态 id 转换为面向用户的中文标签。
 *
 * @example
 * statusLabel('active');      // '运行中'
 * statusLabel('uninstalled'); // '已卸载'
 * statusLabel('unknown');     // '未知'
 */
export function statusLabel(status: string): string {
  if (status === 'active') return '运行中';
  if (status === 'uninstalled') return '已卸载';
  return '未知';
}

/**
 * 从节点记录的 `protocolParams` 中提取服务端口号。
 *
 * 统一语义：端口缺失或类型异常时返回 `undefined`，
 * 由展示层自行决定兜底文案（例如 '未记录'）。
 */
export function extractPort(node: NodeRecord): number | undefined {
  const value = node.protocolParams.port;
  return typeof value === 'number' ? value : undefined;
}
