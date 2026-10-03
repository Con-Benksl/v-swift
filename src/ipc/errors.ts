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

import { t } from 'i18next';
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

export interface UnknownSshHostKey {
  host: string;
  port: string;
  algorithm: string;
  fingerprint: string;
}

export function extractUnknownSshHostKey(error: unknown): UnknownSshHostKey | null {
  const { detail } = normalizeIpcError(error);
  const markerIndex = detail.indexOf('UNKNOWN_SSH_HOST_KEY|');
  if (markerIndex < 0) return null;

  const fields = new Map<string, string>();
  for (const segment of detail.slice(markerIndex).split('|').slice(1)) {
    const separator = segment.indexOf('=');
    if (separator > 0) {
      fields.set(segment.slice(0, separator), segment.slice(separator + 1));
    }
  }
  const host = fields.get('host');
  const port = fields.get('port');
  const algorithm = fields.get('algorithm');
  const fingerprint = fields.get('fingerprint');
  if (!host || !port || !algorithm || !fingerprint) return null;
  return { host, port, algorithm, fingerprint };
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
    return t('ipcErrors.authFailed');
  }
  if (kind === 'HostUnreachable' || haystack.includes('HostUnreachable')) {
    return t('ipcErrors.hostUnreachable', { detail: detail || t('ipcErrors.hostUnreachableHint') });
  }
  if (kind === 'NetworkTimeout' || haystack.includes('NetworkTimeout')) {
    return t('ipcErrors.networkTimeout');
  }
  if (kind === 'SshHostKey' || haystack.includes('SshHostKey')) {
    const unknownKey = extractUnknownSshHostKey(error);
    if (unknownKey) {
      return t('ipcErrors.untrustedHostKey', {
        algorithm: unknownKey.algorithm,
        fingerprint: unknownKey.fingerprint,
      });
    }
    return t('ipcErrors.hostKeyMismatch', { detail: detail || t('ipcErrors.hostKeyMismatchHint') });
  }
  if (kind && detail) return `${kind}: ${detail}`;
  return detail || kind || t('ipcErrors.connectionFailed');
}
