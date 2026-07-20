/**
 * 后端错误信息提炼层。
 *
 * 合并自 `src/components/ConnectForm.tsx` 的 `extractFriendlyError` 与
 * `src/components/DeployProgress.tsx` 的 `extractErrorMessage` 两份近似实现。
 *
 * Tauri IPC 错误形态多样，本模块统一覆盖：
 *   - `Error` 实例
 *   - 纯字符串
 *   - `{ message: string }`
 *   - `{ message: { kind, message, step? } }`（嵌套 serde 错误，step 会作为 `[step]` 前缀）
 *   - `{ error: string | { message } }`
 *   - `{ kind: string }`（Rust 侧 serde-tagged AppError）
 *   - 其余可 JSON 序列化的对象
 */

/**
 * 将任意形态的后端错误提炼为用户可读的中文文案。
 *
 * @param error    `invoke()` 或 Promise 抛出的原始错误。
 * @param fallback 无法从错误中提炼出任何信息时使用的兜底文案，默认 '操作失败'。
 *
 * @example
 * extractErrorMessage(new Error('boom'));                 // 'boom'
 * extractErrorMessage({ kind: 'AuthFailed' });            // 'AuthFailed'
 * extractErrorMessage({ message: { step: 'install', message: '下载失败' } });
 *                                                         // '[install] 下载失败'
 * extractErrorMessage(null, '加载失败');                  // '加载失败'
 */
export function extractErrorMessage(error: unknown, fallback = '操作失败'): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;

  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>;

    const fromMessage = pickMessage(obj.message);
    if (fromMessage) return fromMessage;

    const fromError = pickMessage(obj.error);
    if (fromError) return fromError;

    if (typeof obj.kind === 'string' && obj.kind) return obj.kind;

    try {
      const json = JSON.stringify(error);
      if (json && json !== '{}') return json;
    } catch {
      /* 忽略序列化失败，走兜底文案 */
    }
  }

  return fallback;
}

/**
 * 从错误的 `message` / `error` 字段中提取文案。
 *
 * 字段本身可能是字符串，也可能是 `{ kind, message, step? }` 嵌套对象；
 * 嵌套对象带 `step` 时输出 `[step] message` 形式，便于定位部署阶段。
 */
function pickMessage(field: unknown): string {
  if (typeof field === 'string' && field) return field;

  if (field && typeof field === 'object') {
    const inner = field as Record<string, unknown>;
    if (typeof inner.message === 'string' && inner.message) {
      return typeof inner.step === 'string' && inner.step
        ? `[${inner.step}] ${inner.message}`
        : inner.message;
    }
    if (typeof inner.kind === 'string' && inner.kind) return inner.kind;
  }

  return '';
}
