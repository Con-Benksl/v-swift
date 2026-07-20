import type { ReactNode } from 'react';
import { Card } from './Card';

export interface StatCardProps {
  /** 指标名称（小字，次要色） */
  label: string;
  /** 指标主值（大字，正文色），传格式化好的字符串或节点 */
  value: ReactNode;
  /** 主值下方的辅助信息（如单位说明、环比、峰值），可选 */
  subValue?: ReactNode;
  /** 右上角图标插槽（建议 20px 内联 SVG，组件不负责着色，默认次要色） */
  icon?: ReactNode;
  /**
   * 进度值 0–100。传入时在卡片底部渲染单色 brand 进度条（CPU/内存/磁盘占用场景）；
   * 不传则不渲染（流量/在线时长等纯数值场景）。超出范围自动截断。
   */
  progress?: number;
  /** 附加 className */
  className?: string;
}

/**
 * 指标卡：label + value + 可选 subValue/icon/progress。
 * 覆盖系统监控指标卡（带 progress）与详情页指标卡（纯数值）两种场景。
 * 用法（监控）：`<StatCard label="CPU 占用" value="42%" icon={<CpuIcon />} progress={42} />`
 * 用法（详情）：`<StatCard label="累计下行" value="1.2 GB" subValue="本月" />`
 */
export function StatCard({ label, value, subValue, icon, progress, className = '' }: StatCardProps) {
  const clampedProgress =
    progress === undefined ? undefined : Math.min(100, Math.max(0, progress));

  return (
    <Card padding="md" className={className}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-surface-500 dark:text-surface-400">{label}</p>
          <p className="mt-1.5 truncate text-xl font-semibold leading-tight text-surface-800 dark:text-surface-100">
            {value}
          </p>
          {subValue !== undefined && subValue !== null ? (
            <p className="mt-1 text-xs leading-relaxed text-surface-500 dark:text-surface-400">
              {subValue}
            </p>
          ) : null}
        </div>
        {icon ? (
          <div className="shrink-0 text-surface-500 dark:text-surface-400" aria-hidden="true">
            {icon}
          </div>
        ) : null}
      </div>
      {clampedProgress !== undefined ? (
        <div
          className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-100 dark:bg-surface-700"
          role="progressbar"
          aria-valuenow={Math.round(clampedProgress)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${label} ${Math.round(clampedProgress)}%`}
        >
          <div
            className="h-full rounded-full bg-brand-600 transition-[width] duration-300 dark:bg-brand-500"
            style={{ width: `${clampedProgress}%` }}
          />
        </div>
      ) : null}
    </Card>
  );
}
