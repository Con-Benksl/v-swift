import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** 弹窗尺寸档位 */
export type ModalSize = 'sm' | 'md' | 'lg';

const sizeClass: Record<ModalSize, string> = {
  /** 确认框/提示框（max-w-sm） */
  sm: 'max-w-sm',
  /** 常规表单弹窗（max-w-lg，默认） */
  md: 'max-w-lg',
  /** 复杂内容弹窗（max-w-2xl） */
  lg: 'max-w-2xl',
};

/** 关闭图标（内联极简 SVG，stroke 风格，不引外部库） */
function CloseIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export interface ModalProps {
  /** 是否打开（受控）。false 时不渲染任何内容 */
  open: boolean;
  /** 请求关闭回调（Esc / 遮罩点击 / 关闭按钮均触发，由调用方决定如何置 open=false） */
  onClose: () => void;
  /** 弹窗标题 */
  title: string;
  /** 标题下方的补充说明（可选） */
  description?: string;
  /** 弹窗主体内容 */
  children?: ReactNode;
  /** 底部操作区插槽（通常放 次要按钮 + 主按钮） */
  footer?: ReactNode;
  /** 尺寸档位，默认 `md` */
  size?: ModalSize;
  /** 点击遮罩是否关闭，默认 true */
  closeOnOverlayClick?: boolean;
  /** 按 Esc 是否关闭，默认 true */
  closeOnEsc?: boolean;
  /** 是否显示右上角关闭按钮，默认 true */
  showCloseButton?: boolean;
}

/**
 * 模态弹窗：portal 渲染到 body，含焦点陷阱、Esc 关闭、可配置的遮罩关闭、
 * aria-modal/role="dialog"，标题 + 内容 + footer 插槽，三档尺寸。
 * 打开时锁定 body 滚动，初始焦点落在弹窗内第一个可聚焦元素（否则落在面板本身）。
 * 用法：
 * ```tsx
 * <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="确认卸载节点" size="sm"
 *   footer={<><button className="btn-secondary" onClick={...}>取消</button><button className="btn-danger" onClick={...}>确认卸载</button></>}>
 *   卸载后该节点的服务与配置将被删除，此操作不可恢复。
 * </Modal>
 * ```
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  closeOnOverlayClick = true,
  closeOnEsc = true,
  showCloseButton = true,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleIdRef = useRef(`modal-title-${Math.random().toString(36).slice(2, 9)}`);
  const descIdRef = useRef(`modal-desc-${Math.random().toString(36).slice(2, 9)}`);
  const onCloseRef = useRef(onClose);
  const closeOnEscRef = useRef(closeOnEsc);

  onCloseRef.current = onClose;
  closeOnEscRef.current = closeOnEsc;

  // 记录打开前的焦点元素，关闭后归还
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    previousFocusRef.current = document.activeElement as HTMLElement | null;

    // 锁定背景滚动
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const getFocusableElements = () =>
      panelRef.current
        ? Array.from(
            panelRef.current.querySelectorAll<HTMLElement>(
              'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])',
            ),
          ).filter((element) => element.offsetParent !== null)
        : [];

    // 初始焦点：面板内第一个可聚焦元素，否则面板自身
    const panel = panelRef.current;
    if (panel) {
      (getFocusableElements()[0] ?? panel).focus();
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (closeOnEscRef.current) {
          onCloseRef.current();
        }
        return;
      }
      // 焦点陷阱：Tab 在面板内循环
      if (event.key === 'Tab' && panelRef.current) {
        const focusables = getFocusableElements();
        if (focusables.length === 0) {
          event.preventDefault();
          panelRef.current.focus();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (event.shiftKey) {
          if (active === first || !panelRef.current.contains(active)) {
            event.preventDefault();
            last.focus();
          }
        } else if (active === last || !panelRef.current.contains(active)) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = originalOverflow;
      previousFocusRef.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const handleOverlayMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    // 仅在遮罩本身按下时关闭（避免面板内文本选择拖出遮罩误触发）
    if (closeOnOverlayClick && event.target === event.currentTarget) {
      onClose();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/40 p-4 backdrop-blur-[2px] motion-safe:animate-fade-in dark:bg-surface-950/60"
      onMouseDown={handleOverlayMouseDown}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleIdRef.current}
        aria-describedby={description ? descIdRef.current : undefined}
        tabIndex={-1}
        className={`w-full ${sizeClass[size]} rounded-panel border border-surface-border bg-surface-card shadow-pop outline-none motion-safe:animate-scale-in dark:border-surface-700 dark:bg-surface-800`}
      >
        {/* 头部：标题 + 说明 + 关闭按钮 */}
        <div className="flex items-start justify-between gap-4 border-b border-surface-border px-5 py-4 dark:border-surface-700">
          <div className="min-w-0">
            <h2
              id={titleIdRef.current}
              className="text-base font-semibold leading-snug text-surface-800 dark:text-surface-100"
            >
              {title}
            </h2>
            {description ? (
              <p
                id={descIdRef.current}
                className="mt-1 text-sm leading-relaxed text-surface-500 dark:text-surface-400"
              >
                {description}
              </p>
            ) : null}
          </div>
          {showCloseButton ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭弹窗"
              className="shrink-0 rounded-control p-1.5 text-surface-500 transition-colors duration-150 hover:bg-surface-100 hover:text-surface-700 dark:text-surface-400 dark:hover:bg-surface-700 dark:hover:text-surface-200"
            >
              <CloseIcon />
            </button>
          ) : null}
        </div>

        {/* 主体 */}
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4 text-sm leading-relaxed text-surface-700 dark:text-surface-300">
          {children}
        </div>

        {/* 底部操作区 */}
        {footer ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-surface-border px-5 py-4 dark:border-surface-700">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
