import type { HTMLAttributes } from 'react';

/** Badge 语义变体（视觉唯一定义在 index.css 的 .badge-* 全局类，本组件为薄包装） */
export type BadgeVariant = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /**
   * 语义变体：neutral 中性 / success 成功·运行中 / warning 警告 / danger 错误·已停止 / info 信息
   * @default 'neutral'
   */
  variant?: BadgeVariant;
  /**
   * 左侧状态色点（用于运行状态指示，颜色随 variant 联动）
   * @default false
   */
  dot?: boolean;
}

const variantClass: Record<BadgeVariant, string> = {
  neutral: 'badge-neutral',
  success: 'badge-success',
  warning: 'badge-warning',
  danger: 'badge-danger',
  info: 'badge-info',
};

/* 色点用 500 档实心色，在明暗两种模式的浅底徽章上都清晰 */
const dotClass: Record<BadgeVariant, string> = {
  neutral: 'bg-surface-400',
  success: 'bg-success-500',
  warning: 'bg-warning-500',
  danger: 'bg-danger-500',
  info: 'bg-info-500',
};

/**
 * 徽章：index.css `.badge-*` 全局类的薄包装，浅底深字；dot=true 时左侧加状态色点。
 * 用法：<Badge variant="success" dot>运行中</Badge>
 */
export function Badge({ variant = 'neutral', dot = false, className = '', children, ...rest }: BadgeProps) {
  return (
    <span className={`${variantClass[variant]} ${className}`.trim()} {...rest}>
      {dot ? <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass[variant]}`} /> : null}
      {children}
    </span>
  );
}
