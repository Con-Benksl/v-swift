import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

/** 卡片内边距档位 */
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

const paddingClass: Record<CardPadding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * 内边距档位。
   * - `none`：无内边距（自定义内部布局，如表格卡）
   * - `sm`：p-3，紧凑列表卡
   * - `md`：p-4，默认密度（默认）
   * - `lg`：p-6，表单/详情卡
   */
  padding?: CardPadding;
  /**
   * 是否启用 hover 浮起态（阴影升级为 shadow-pop + 描边加深）。
   * 仅当整卡可交互（可点击）时使用。
   */
  hoverable?: boolean;
  /** 卡片内容 */
  children?: ReactNode;
}

/**
 * 基础卡片容器：rounded-card + 白底(暗色 surface-800) + 细描边 + shadow-card。
 * 用法：`<Card padding="md">内容</Card>`；可点击卡片：`<Card hoverable onClick={...}>`
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { padding = 'md', hoverable = false, className = '', children, ...rest },
  ref,
) {
  const classes = [
    'rounded-card border border-surface-border bg-surface-card shadow-card',
    'dark:border-surface-700 dark:bg-surface-800',
    hoverable
      ? 'transition-shadow duration-150 hover:border-surface-300 hover:shadow-pop dark:hover:border-surface-600'
      : '',
    paddingClass[padding],
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div ref={ref} className={classes} {...rest}>
      {children}
    </div>
  );
});
