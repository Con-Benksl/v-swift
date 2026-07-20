/** Spinner 尺寸档位 */
export type SpinnerSize = 'sm' | 'md' | 'lg';

export interface SpinnerProps {
  /**
   * 尺寸档位：sm=14px（按钮/徽章内联）、md=16px（默认，按钮 md 内联）、lg=24px（区块级加载）
   * @default 'md'
   */
  size?: SpinnerSize;
  /**
   * 颜色模式：brand=品牌色（独立使用时）；inherit=跟随父级 currentColor（放在彩色按钮内时使用）
   * @default 'brand'
   */
  tone?: 'brand' | 'inherit';
  /**
   * 无障碍标签（aria-label）
   * @default '加载中'
   */
  label?: string;
  /** 追加到根元素的 className */
  className?: string;
}

const sizeClass: Record<SpinnerSize, string> = {
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
  lg: 'h-6 w-6',
};

/**
 * 加载指示器：品牌色圆环 + 纯 CSS 旋转动画（animate-spin），带 aria-label。
 * 用法：<Spinner size="sm" tone="inherit" />
 */
export function Spinner({ size = 'md', tone = 'brand', label = '加载中', className = '' }: SpinnerProps) {
  const toneClass = tone === 'brand' ? 'text-brand-600 dark:text-brand-400' : 'text-current';
  return (
    <svg
      className={`shrink-0 animate-spin ${sizeClass[size]} ${toneClass} ${className}`.trim()}
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label={label}
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M22 12a10 10 0 0 0-10-10v4a6 6 0 0 1 6 6h4z" />
    </svg>
  );
}
