import type { ReactNode } from 'react';

export interface SectionHeaderProps {
  /**
   * 眉题（中文小标题，置于主标题上方，品牌色小字）。
   * 仅用于标识页面/区块归属，如「节点管理」「控制面板」；不要传英文大写装饰词。
   */
  eyebrow?: string;
  /** 主标题（必填） */
  title: string;
  /** 标题下方的说明文字（可选） */
  description?: string;
  /** 右侧操作区插槽，通常放主按钮/次要按钮组 */
  actions?: ReactNode;
  /** 附加 className（用于调整间距等） */
  className?: string;
}

/**
 * 区块/页头：眉题 + 标题 + 说明 + 右侧 actions 插槽。
 * 用法：`<SectionHeader eyebrow="节点管理" title="全部节点" description="按 VPS 分组" actions={<button className="btn-primary">新建节点</button>} />`
 */
export function SectionHeader({ eyebrow, title, description, actions, className = '' }: SectionHeaderProps) {
  return (
    <div className={`flex flex-wrap items-start justify-between gap-x-4 gap-y-3 ${className}`.trim()}>
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1 text-xs font-medium text-brand-600 dark:text-brand-300">{eyebrow}</p>
        ) : null}
        <h1 className="break-words text-xl font-semibold leading-tight text-surface-800 dark:text-surface-100">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 break-words text-sm leading-relaxed text-surface-500 dark:text-surface-400">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
