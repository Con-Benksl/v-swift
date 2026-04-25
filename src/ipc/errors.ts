/**
 * Maps a Tauri IPC error (from `invoke()`) to a user-facing Chinese message.
 *
 * Tauri may wrap the Rust-side serde-tagged AppError in various shapes:
 *   - `{ kind: 'AuthFailed', message: ... }`
 *   - `{ message: { kind: 'AuthFailed', message: ... } }`
 *   - a plain string
 *   - an Error instance
 *
 * This helper normalizes all of them and returns a human-readable Chinese string.
 */
function normalizeIpcError(error: unknown): { kind: string; detail: string } {
  let kind = '';
  let detail = '';

  if (error instanceof Error) {
    detail = error.message;
  } else if (typeof error === 'string') {
    detail = error;
  } else if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    if (typeof obj.kind === 'string') kind = obj.kind;
    if (typeof obj.message === 'string') {
      detail = obj.message;
    } else if (obj.message && typeof obj.message === 'object') {
      const inner = obj.message as Record<string, unknown>;
      if (typeof inner.kind === 'string' && !kind) kind = inner.kind;
      if (typeof inner.message === 'string') detail = inner.message;
    }
    if (!detail) {
      try {
        detail = JSON.stringify(error);
      } catch {
        detail = '';
      }
    }
  }

  return { kind, detail };
}

export function extractIpcErrorMessage(error: unknown, fallback: string): string {
  const { kind, detail } = normalizeIpcError(error);
  if (kind && detail) return `${kind}: ${detail}`;
  return detail || kind || fallback;
}

export function mapConnectionError(error: unknown): string {
  const { kind, detail } = normalizeIpcError(error);
  const haystack = `${kind} ${detail}`;
  if (kind === 'AuthFailed' || haystack.includes('AuthFailed')) {
    return '认证失败，请检查用户名、密码或私钥。';
  }
  if (kind === 'HostUnreachable' || haystack.includes('HostUnreachable')) {
    return `目标主机不可达：${detail || '请检查 IP、端口和安全组。'}`;
  }
  if (kind === 'NetworkTimeout' || haystack.includes('NetworkTimeout')) {
    return '连接超时：服务器在 15 秒内没有响应（可能下线、端口被封或路由不通）。';
  }
  if (kind === 'SshHostKey' || haystack.includes('SshHostKey')) {
    return `SSH 主机密钥校验失败：${detail || '服务器身份和已信任记录不一致。'}`;
  }
  if (kind && detail) return `${kind}: ${detail}`;
  return detail || kind || '连接失败';
}
