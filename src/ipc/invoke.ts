/**
 * invoke/listen 兼容层：Tauri 环境直连真实后端；
 * 纯浏览器 dev（npm run dev 直接开页面）走 devMock，让前端全流程可独立预览。
 * 生产构建里 isTauriRuntime 恒为 true，mock 分支不会被执行。
 */
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen, type EventCallback, type UnlistenFn } from '@tauri-apps/api/event';

const isTauriRuntime = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const useMock = import.meta.env.DEV && !isTauriRuntime;

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (useMock) {
    const { mockInvoke } = await import('./devMock');
    return mockInvoke<T>(cmd, args);
  }
  return tauriInvoke<T>(cmd, args);
}

export async function listen<T>(eventName: string, handler: EventCallback<T>): Promise<UnlistenFn> {
  if (useMock) {
    const { registerMockListener } = await import('./devMock');
    return registerMockListener(eventName, (payload) =>
      handler({ event: eventName, id: 0, payload: payload as T }),
    );
  }
  return tauriListen<T>(eventName, handler);
}

export type { UnlistenFn };
