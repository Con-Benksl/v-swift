import { SystemStatus } from '../../ipc/control';

interface StatusCardProps {
  title: string;
  value: string;
  percent: number;
  subValue?: string;
  icon: React.ReactNode;
  color: 'blue' | 'emerald' | 'amber' | 'purple';
}

const colorMap = {
  blue: {
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-600',
    progress: 'bg-blue-500',
  },
  emerald: {
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    iconBg: 'bg-emerald-100',
    iconColor: 'text-emerald-600',
    progress: 'bg-emerald-500',
  },
  amber: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-600',
    progress: 'bg-amber-500',
  },
  purple: {
    bg: 'bg-purple-50',
    border: 'border-purple-200',
    iconBg: 'bg-purple-100',
    iconColor: 'text-purple-600',
    progress: 'bg-purple-500',
  },
};

export function StatusCard({ title, value, percent, subValue, icon, color }: StatusCardProps) {
  const colors = colorMap[color];

  return (
    <div className={`rounded-3xl border ${colors.border} ${colors.bg} p-5 shadow-sm`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
          {subValue && <p className="mt-1 text-xs text-slate-400">{subValue}</p>}
        </div>
        <div className={`rounded-2xl ${colors.iconBg} p-3 ${colors.iconColor}`}>{icon}</div>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/60">
        <div
          className={`h-full rounded-full transition-all duration-500 ${colors.progress}`}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
      <p className="mt-2 text-right text-xs font-medium text-slate-400">{percent.toFixed(1)}%</p>
    </div>
  );
}

function CpuIcon() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25zm.75-12h9v9h-9v-9z"
      />
    </svg>
  );
}

function MemoryIcon() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125"
      />
    </svg>
  );
}

function DiskIcon() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859m-16.5 0a2.25 2.25 0 00-.943-1.664l-4.175-4.175a2.25 2.25 0 00-.659-1.591V7.5A2.25 2.25 0 016 5.25h11A2.25 2.25 0 0119.25 7.5v6.5a2.25 2.25 0 01-.659 1.591l-4.175 4.175a2.25 2.25 0 00-.659 1.591v1.5m-12.75 0a2.25 2.25 0 00-.943-1.664l-4.175-4.175a2.25 2.25 0 00-.659-1.591V7.5A2.25 2.25 0 016 5.25h11a2.25 2.25 0 012.25 2.25v6.5a2.25 2.25 0 01-.659 1.591l-4.175 4.175a2.25 2.25 0 00-.659 1.591v1.5m-12.75 0l3.75 3.75m0 0l3.75-3.75m-3.75 3.75h9"
      />
    </svg>
  );
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
  return `${minutes} 分钟`;
}

interface SystemStatusCardsProps {
  status: SystemStatus | null;
  loading?: boolean;
}

export function SystemStatusCards({ status, loading }: SystemStatusCardsProps) {
  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="animate-pulse rounded-3xl border border-slate-200 bg-slate-100 p-5 shadow-sm"
          >
            <div className="h-4 w-20 rounded bg-slate-300" />
            <div className="mt-3 h-8 w-24 rounded bg-slate-300" />
            <div className="mt-4 h-2 rounded bg-slate-300" />
          </div>
        ))}
      </div>
    );
  }

  if (!status) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-300 bg-white/90 p-10 text-center shadow-sm shadow-slate-200/60">
        <p className="text-sm text-slate-500">选择 VPS 后会显示系统状态</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <StatusCard
        title="CPU 使用率"
        value={`${status.cpuPercent.toFixed(1)}%`}
        percent={status.cpuPercent}
        icon={<CpuIcon />}
        color="blue"
      />
      <StatusCard
        title="内存"
        value={`${(status.memoryUsed / 1024).toFixed(1)} GB`}
        subValue={`总计 ${(status.memoryTotal / 1024).toFixed(1)} GB`}
        percent={status.memoryTotal > 0 ? (status.memoryUsed / status.memoryTotal) * 100 : 0}
        icon={<MemoryIcon />}
        color="emerald"
      />
      <StatusCard
        title="磁盘"
        value={`${(status.diskUsed / (1024 * 1024 * 1024)).toFixed(1)} GB`}
        subValue={`总计 ${(status.diskTotal / (1024 * 1024 * 1024)).toFixed(1)} GB · 运行 ${formatUptime(status.uptimeSeconds)}`}
        percent={status.diskUsagePercent}
        icon={<DiskIcon />}
        color="amber"
      />
    </div>
  );
}

interface NetworkRateCardProps {
  rxRateBps: number;
  txRateBps: number;
  loading?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function NetworkRateCard({ rxRateBps, txRateBps, loading }: NetworkRateCardProps) {
  if (loading) {
    return (
      <div className="rounded-3xl border border-purple-200 bg-purple-50 p-5 shadow-sm">
        <div className="animate-pulse">
          <div className="h-4 w-20 rounded bg-purple-200" />
          <div className="mt-2 h-8 w-32 rounded bg-purple-200" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-purple-200 bg-purple-50 p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">流量统计</p>
      <div className="mt-3 flex gap-6">
        <div>
          <p className="text-xs text-slate-400">↓ 下载总量</p>
          <p className="mt-1 text-lg font-semibold text-purple-600">{formatBytes(rxRateBps)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">↑ 上传总量</p>
          <p className="mt-1 text-lg font-semibold text-purple-600">{formatBytes(txRateBps)}</p>
        </div>
      </div>
    </div>
  );
}
