import { useRef } from 'react';
import type { KeyboardEvent } from 'react';

/** SegmentedControl 选项 */
export interface SegmentedControlOption<T extends string = string> {
  /** 选项值（受控值） */
  value: T;
  /** 选项文案 */
  label: string;
  /** 禁用该选项 */
  disabled?: boolean;
}

/** SegmentedControl 尺寸档位 */
export type SegmentedControlSize = 'sm' | 'md';

export interface SegmentedControlProps<T extends string = string> {
  /** 选项列表 */
  options: SegmentedControlOption<T>[];
  /** 当前选中值（受控） */
  value: T;
  /** 选中变化回调（点击或键盘切换时触发） */
  onChange: (value: T) => void;
  /**
   * 尺寸：sm=选项高 24px 文字 xs；md=选项高 28px 文字 sm
   * @default 'md'
   */
  size?: SegmentedControlSize;
  /** 追加到根元素的 className */
  className?: string;
  /** 无障碍组标签（aria-label），建议填写用途，如「连接方式」 */
  'aria-label'?: string;
}

const sizeClass: Record<SegmentedControlSize, string> = {
  sm: 'h-6 px-2.5 text-xs',
  md: 'h-7 px-3 text-sm',
};

/**
 * 分段选择器：受控选项组（如「已保存 / 新建」切换）。
 * 激活态为浅底胶囊 + 品牌色文字；键盘支持 ←/→/↑/↓ 切换与 Home/End 跳转（roving tabindex + radiogroup 语义）。
 * 用法：<SegmentedControl options={[{value:'saved',label:'已保存'},{value:'new',label:'新建'}]} value={tab} onChange={setTab} />
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  className = '',
  'aria-label': ariaLabel,
}: SegmentedControlProps<T>) {
  const itemRefs = useRef(new Map<T, HTMLButtonElement>());

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const enabled = options.filter((o) => !o.disabled);
    if (enabled.length === 0) return;
    const current = enabled.findIndex((o) => o.value === value);
    let nextIndex: number;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextIndex = (current + 1 + enabled.length) % enabled.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIndex = (current - 1 + enabled.length) % enabled.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = enabled.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    const next = enabled[nextIndex];
    if (next.value !== value) {
      onChange(next.value);
    }
    itemRefs.current.get(next.value)?.focus();
  };

  /* value 未命中任何选项时，让首个可用选项可聚焦，保证键盘可进入 */
  const hasActive = options.some((o) => o.value === value);
  const firstEnabled = options.find((o) => !o.disabled)?.value;

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className={`inline-flex items-center gap-0.5 rounded-control border border-surface-border bg-surface-100 p-0.5 dark:border-surface-700 dark:bg-surface-900 ${className}`.trim()}
    >
      {options.map((option) => {
        const active = option.value === value;
        const tabbable = active || (!hasActive && option.value === firstEnabled);
        return (
          <button
            key={option.value}
            ref={(el) => {
              if (el) {
                itemRefs.current.set(option.value, el);
              } else {
                itemRefs.current.delete(option.value);
              }
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={tabbable ? 0 : -1}
            disabled={option.disabled}
            onClick={() => {
              if (!active) {
                onChange(option.value);
              }
            }}
            className={`inline-flex items-center justify-center whitespace-nowrap rounded-md font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${sizeClass[size]} ${
              active
                ? 'bg-surface-card text-brand-600 shadow-card dark:bg-surface-700 dark:text-brand-200'
                : 'text-surface-500 hover:text-surface-800 dark:text-surface-400 dark:hover:text-surface-100'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
