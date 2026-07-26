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
  /**
   * 色点呼吸外环（仅表示「正在发生」的实时状态时开启，如运行中/连接中；
   * 静态结果不要开，避免页面到处闪动）
   * @default false
   */
  pulse?: boolean;
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
export function Badge({
  variant = 'neutral',
  dot = false,
  pulse = false,
  className = '',
  children,
  ...rest
}: BadgeProps) {
  return (
    <span className={`${variantClass[variant]} ${className}`.trim()} {...rest}>
      {dot ? (
        <span aria-hidden="true" className="relative flex h-1.5 w-1.5 shrink-0">
          {pulse ? (
            <span
              className={`absolute inset-0 rounded-full motion-safe:animate-ping-soft ${dotClass[variant]}`}
            />
          ) : null}
          <span className={`relative h-1.5 w-1.5 rounded-full ${dotClass[variant]}`} />
        </span>
      ) : null}
      {children}
    </span>
  );
}
