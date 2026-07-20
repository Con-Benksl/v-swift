import type { HTMLAttributes } from 'react';

/** 骨架屏变体 */
export type SkeletonVariant = 'block' | 'line' | 'circle';

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * 形状变体：
   * - `block`：矩形块（默认），用 className 里的 w/h 控制尺寸，圆角 rounded-control
   * - `line`：文本行（h-4 + rounded-full），默认 w-full，用 className 覆盖宽度模拟长短句
   * - `circle`：圆形（宽高相等），用 className 里的 size-* 或 w/h 控制直径
   */
  variant?: SkeletonVariant;
}

/**
 * 骨架屏基础件（pulse 动画），供各页拼装与实物同布局的加载占位。
 * 用法：`<Skeleton variant="line" className="w-2/3" />`、`<Skeleton variant="circle" className="size-10" />`、
 * `<Skeleton variant="block" className="h-24 w-full" />`
 */
export function Skeleton({ variant = 'block', className = '', ...rest }: SkeletonProps) {
  const base = 'animate-pulse bg-surface-200 dark:bg-surface-700';
  const shape: Record<SkeletonVariant, string> = {
    block: 'rounded-control',
    line: 'h-4 w-full rounded-full',
    circle: 'size-10 rounded-full',
  };

  return <div className={`${base} ${shape[variant]} ${className}`.trim()} aria-hidden="true" {...rest} />;
}

/**
 * 多行文本骨架快捷件：指定行数，末行自动缩短为 2/3 宽，模拟自然段落。
 * 用法：`<SkeletonText lines={3} />`
 */
export function SkeletonText({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`.trim()} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} variant="line" className={i === lines - 1 ? 'w-2/3' : 'w-full'} />
      ))}
    </div>
  );
}
