import type { HTMLAttributes, ReactNode } from 'react';

/** 页面内容最大宽度档位 */
export type PageShellWidth = 'md' | 'lg' | 'xl' | 'full';

const widthClass: Record<PageShellWidth, string> = {
  /** 表单/向导类窄页（约 48rem 内容区） */
  md: 'max-w-3xl',
  /** 详情页（约 64rem 内容区） */
  lg: 'max-w-5xl',
  /** 列表/监控类宽页（约 80rem 内容区，默认） */
  xl: 'max-w-7xl',
  /** 不限制宽度（日志查看器等需要铺满的场景） */
  full: 'max-w-none',
};

export interface PageShellProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * 内容最大宽度档位，默认 `xl`（max-w-7xl）。
   * 表单/向导建议 `md`，详情页 `lg`，监控/列表 `xl`，日志查看器 `full`。
   */
  width?: PageShellWidth;
  /** 页面内容 */
  children?: ReactNode;
}

/**
 * 页面根容器：挂载全局 .app-shell 类（唯一页面背景定义处，含暗色与 min-h-screen），
 * 叠加居中容器 + 统一内边距。每个页面的根节点必须使用它。
 * 用法：`<PageShell width="lg"><SectionHeader ... />...</PageShell>`
 */
export function PageShell({ width = 'xl', className = '', children, ...rest }: PageShellProps) {
  const classes = ['app-shell', className].filter(Boolean).join(' ');

  return (
    <div className={classes} {...rest}>
      {/* 页面级入场：轻微上移淡入（切路由时重挂载触发；系统减弱动效时自动跳过） */}
      <div
        className={`mx-auto w-full ${widthClass[width]} px-4 py-6 motion-safe:animate-fade-up sm:px-6 lg:px-8`}
      >
        {children}
      </div>
    </div>
  );
}
