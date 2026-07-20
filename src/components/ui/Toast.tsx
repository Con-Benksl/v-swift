import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Toast 语义类型 */
export type ToastKind = 'success' | 'error' | 'info';

/** 单条 Toast 的可配项 */
export interface ToastOptions {
  /**
   * 自动消失时长（毫秒）
   * @default 2500
   */
  duration?: number;
}

/** useToast() 返回的调用 API */
export interface ToastApi {
  /** 成功反馈（如：复制成功、卸载成功） */
  success: (message: string, options?: ToastOptions) => void;
  /** 失败反馈（如：操作失败原因） */
  error: (message: string, options?: ToastOptions) => void;
  /** 中性提示 */
  info: (message: string, options?: ToastOptions) => void;
}

interface ToastRecord {
  id: number;
  kind: ToastKind;
  message: string;
  duration: number;
}

const DEFAULT_DURATION = 2500;
/** 出场过渡时长（与 ToastItem 的 transition duration-200 保持一致） */
const EXIT_MS = 200;

const ToastContext = createContext<ToastApi | null>(null);

/**
 * 读取 Toast API，必须在 <ToastProvider> 内使用。
 * 用法：const toast = useToast(); toast.success('已复制到剪贴板');
 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast 必须在 <ToastProvider> 内使用');
  }
  return ctx;
}

/* 类型图标：stroke 风格，24px viewBox；图标色 500 档在浅色卡片上清晰，暗色卡片上换 400 档提亮 */
const kindIcon: Record<ToastKind, ReactNode> = {
  success: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-4 w-4 shrink-0 text-success-500 dark:text-success-400"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 5-6" />
    </svg>
  ),
  error: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-4 w-4 shrink-0 text-danger-500 dark:text-danger-400"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="m9 9 6 6" />
      <path d="m15 9-6 6" />
    </svg>
  ),
  info: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-4 w-4 shrink-0 text-info-500 dark:text-info-400"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </svg>
  ),
};

type Phase = 'enter' | 'visible' | 'leaving';

function ToastItem({ toast, onRemove }: { toast: ToastRecord; onRemove: (id: number) => void }) {
  const [phase, setPhase] = useState<Phase>('enter');

  /* 入场：双 rAF 保证首帧先以 enter 态绘制，再过渡到 visible */
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => setPhase('visible'));
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  /* 停留 duration 后进入出场态 */
  useEffect(() => {
    if (phase !== 'visible') return;
    const timer = window.setTimeout(() => setPhase('leaving'), toast.duration);
    return () => window.clearTimeout(timer);
  }, [phase, toast.duration]);

  /* 出场过渡结束后从列表移除 */
  useEffect(() => {
    if (phase !== 'leaving') return;
    const timer = window.setTimeout(() => onRemove(toast.id), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [phase, toast.id, onRemove]);

  const motionClass = phase === 'visible' ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0';

  return (
    <div
      role={toast.kind === 'error' ? 'alert' : 'status'}
      className={`pointer-events-auto flex max-w-sm items-center gap-2 rounded-full border border-surface-border bg-surface-card py-2 pl-3 pr-2 text-sm text-surface-800 shadow-pop transition-all duration-200 ease-out dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100 ${motionClass}`}
    >
      {kindIcon[toast.kind]}
      <span className="min-w-0 break-words">{toast.message}</span>
      <button
        type="button"
        aria-label="关闭通知"
        title="关闭通知"
        onClick={() => setPhase('leaving')}
        className="ml-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-surface-500 transition-colors hover:bg-surface-100 hover:text-surface-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 dark:text-surface-400 dark:hover:bg-surface-700 dark:hover:text-surface-100"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
          className="h-3.5 w-3.5"
        >
          <path d="m7 7 10 10" />
          <path d="M17 7 7 17" />
        </svg>
      </button>
    </div>
  );
}

export interface ToastProviderProps {
  children: ReactNode;
}

/**
 * Toast 容器：在应用根部挂一次（如 App.tsx 最外层），全局任意组件用 useToast() 触发。
 * 底部居中浮条，success/error/info 三态，入场/出场过渡，默认 2.5s 自动消失，可通过关闭按钮立即关闭。
 *
 * 用法：
 *   <ToastProvider><App /></ToastProvider>
 *   // 子组件内：const toast = useToast(); toast.error('操作失败：权限不足', { duration: 4000 });
 */
export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const nextIdRef = useRef(0);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((kind: ToastKind, message: string, options?: ToastOptions) => {
    nextIdRef.current += 1;
    const id = nextIdRef.current;
    setToasts((prev) => [...prev, { id, kind, message, duration: options?.duration ?? DEFAULT_DURATION }]);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (message, options) => push('success', message, options),
      error: (message, options) => push('error', message, options),
      info: (message, options) => push('info', message, options),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2 px-4"
        >
          {toasts.map((t) => (
            <ToastItem key={t.id} toast={t} onRemove={remove} />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}
