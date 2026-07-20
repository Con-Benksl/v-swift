import { useState } from 'react';
import type { HTMLAttributes, ReactNode } from 'react';

/** Callout 语义变体（视觉唯一定义在 index.css 的 .callout-* 全局类，本组件为薄包装） */
export type CalloutVariant = 'info' | 'warning' | 'danger';

export interface CalloutProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /**
   * 语义变体：info 信息提示 / warning 警告 / danger 错误
   * @default 'info'
   */
  variant?: CalloutVariant;
  /** 标题（加粗，置于内容上方；不传则内容顶格） */
  title?: ReactNode;
  /**
   * 显示右上角关闭按钮；点击后组件自行隐藏
   * @default false
   */
  closable?: boolean;
  /** 点击关闭按钮后的回调（在内部隐藏之后触发，用于外部状态联动） */
  onClose?: () => void;
}

const variantClass: Record<CalloutVariant, string> = {
  info: 'callout-info',
  warning: 'callout-warning',
  danger: 'callout-danger',
};

/* 变体图标：stroke 风格，24px viewBox，颜色继承各 .callout-* 的语义文字色（currentColor） */
const variantIcon: Record<CalloutVariant, ReactNode> = {
  info: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="mt-0.5 h-4 w-4 shrink-0"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </svg>
  ),
  warning: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="mt-0.5 h-4 w-4 shrink-0"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  ),
  danger: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="mt-0.5 h-4 w-4 shrink-0"
    >
      <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2" />
      <path d="M12 8v5" />
      <path d="M12 16.5h.01" />
    </svg>
  ),
};

/**
 * 提示条：index.css `.callout-*` 全局类的薄包装（左侧描边 + 浅底），三档语义。
 * 带变体图标；closable 时右上角出现关闭按钮，点击自行隐藏并触发 onClose。
 * 用法：<Callout variant="danger" title="连接失败" closable>错误详情文本</Callout>
 */
export function Callout({
  variant = 'info',
  title,
  closable = false,
  onClose,
  className = '',
  children,
  ...rest
}: CalloutProps) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <div
      className={`${variantClass[variant]} ${className}`.trim()}
      role={variant === 'danger' ? 'alert' : 'status'}
      {...rest}
    >
      <div className="flex items-start gap-2.5">
        {variantIcon[variant]}
        <div className="min-w-0 flex-1">
          {title ? <p className="font-medium">{title}</p> : null}
          <div className={title ? 'mt-1' : undefined}>{children}</div>
        </div>
        {closable ? (
          <button
            type="button"
            aria-label="关闭"
            onClick={() => {
              setHidden(true);
              onClose?.();
            }}
            className="-mr-1 -mt-1 shrink-0 rounded-control p-1 opacity-60 transition-opacity hover:opacity-100"
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
              <path d="m6 6 12 12" />
              <path d="M18 6 6 18" />
            </svg>
          </button>
        ) : null}
      </div>
    </div>
  );
}
