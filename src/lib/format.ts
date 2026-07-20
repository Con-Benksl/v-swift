/**
 * 通用格式化工具。
 *
 * 合并自以下来源（此前各自为政、精度规则不一致）：
 *   - `src/components/control/StatusCard.tsx` 的 `formatBytes` / `formatUptime`
 *   - `src/components/UpdateControl.tsx` 的 `formatBytes`（旧版只支持到 MB）
 *   - `src/pages/NodeList.tsx` 的 `normalizeTimestamp` / `formatRelativeTime`
 *   - `src/pages/NodeDetail.tsx` 的 `formatAbsoluteTime`
 */

const KIB = 1024;
const MIB = KIB * 1024;
const GIB = MIB * 1024;
const TIB = GIB * 1024;

/**
 * 将字节数格式化为用户可读字符串，统一保留 1 位小数，最大支持到 TB。
 *
 * @example
 * formatBytes(512);            // '512 B'
 * formatBytes(2048);           // '2.0 KB'
 * formatBytes(5 * 1024 ** 3);  // '5.0 GB'
 * formatBytes(2 * 1024 ** 4);  // '2.0 TB'
 */
export function formatBytes(bytes: number): string {
  if (bytes < KIB) return `${bytes} B`;
  if (bytes < MIB) return `${(bytes / KIB).toFixed(1)} KB`;
  if (bytes < GIB) return `${(bytes / MIB).toFixed(1)} MB`;
  if (bytes < TIB) return `${(bytes / GIB).toFixed(1)} GB`;
  return `${(bytes / TIB).toFixed(1)} TB`;
}

/**
 * 将后端返回的时间戳统一归一化为毫秒。
 *
 * 后端部分记录使用秒级时间戳：凡小于 1e12 的值视为秒，乘以 1000 转为毫秒。
 */
export function normalizeTimestamp(timestamp: number): number {
  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
}

/**
 * 将时间戳格式化为相对时间（'刚刚' / 'N 分钟前' / 'N 小时前' / 'N 天前'）。
 *
 * 自动兼容秒级与毫秒级时间戳（内部调用 {@link normalizeTimestamp}）。
 */
export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - normalizeTimestamp(timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  return `${Math.floor(diff / day)} 天前`;
}

/**
 * 将时间戳格式化为 zh-CN 绝对时间（含年份，精确到分钟）。
 *
 * 自动兼容秒级与毫秒级时间戳（内部调用 {@link normalizeTimestamp}）。
 *
 * @example 输出形如 '2026/07/18 15:04'
 */
export function formatAbsoluteTime(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(normalizeTimestamp(timestamp));
}

/**
 * 将运行时长（秒）格式化为用户可读的中文时长。
 *
 * @example
 * formatUptime(300);        // '5 分钟'
 * formatUptime(7_500);      // '2 小时 5 分钟'
 * formatUptime(200_000);    // '2 天 7 小时'
 */
export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);

  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
  return `${minutes} 分钟`;
}
