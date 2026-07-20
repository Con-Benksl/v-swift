import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import { Spinner } from './Spinner';

/** Button 视觉变体（视觉唯一定义在 index.css 的 .btn-* 全局类，本组件为薄包装） */
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

/** Button 尺寸档位 */
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * 视觉变体：primary 主行动 / secondary 次行动 / danger 危险操作 / ghost 低视觉重量
   * @default 'primary'
   */
  variant?: ButtonVariant;
  /**
   * 尺寸：sm=高 28px 文字 xs；md=高 36px 文字 sm（.btn 全局类内置）
   * @default 'md'
   */
  size?: ButtonSize;
  /**
   * 加载态：前置 Spinner 并禁用点击；配合 loadingText 切换文案
   * @default false
   */
  loading?: boolean;
  /** 加载态替代文案（不传则保持 children，避免宽度跳动建议传入） */
  loadingText?: string;
}

const variantClass: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  danger: 'btn-danger',
  ghost: 'btn-ghost',
};

/* .btn 内置 md 尺寸（h-9 / px-3.5 / text-sm）；sm 用工具类覆盖（utilities 层在 components 层之后，稳定胜出） */
const sizeClass: Record<ButtonSize, string> = {
  sm: 'h-7 gap-1 px-2.5 text-xs',
  md: '',
};

/**
 * 按钮：index.css `.btn-*` 全局类的薄包装，不产生第二份视觉定义。
 * 默认 type="button"；支持 forwardRef、loading（内置 Spinner + 文案切换）与 disabled。
 * 用法：<Button variant="secondary" size="sm" loading={saving} loadingText="保存中…">保存</Button>
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    loadingText,
    disabled,
    type = 'button',
    className = '',
    children,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${variantClass[variant]} ${sizeClass[size]} ${className}`.replace(/\s+/g, ' ').trim()}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' ? 'sm' : 'md'} tone="inherit" label="处理中" /> : null}
      {loading && loadingText ? loadingText : children}
    </button>
  );
});
