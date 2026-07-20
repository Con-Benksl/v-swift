import { SystemStatus } from '../../ipc/control';
import { formatBytes, formatUptime } from '../../lib';
import { Card, Skeleton, StatCard } from '../ui';

function CpuIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
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
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
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
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859m-16.5 0a2.25 2.25 0 00-.943-1.664l-4.175-4.175a2.25 2.25 0 00-.659-1.591V7.5A2.25 2.25 0 016 5.25h11A2.25 2.25 0 0119.25 7.5v6.5a2.25 2.25 0 01-.659 1.591l-4.175 4.175a2.25 2.25 0 00-.659 1.591v1.5m-12.75 0a2.25 2.25 0 00-.943-1.664l-4.175-4.175a2.25 2.25 0 00-.659-1.591V7.5A2.25 2.25 0 016 5.25h11a2.25 2.25 0 012.25 2.25v6.5a2.25 2.25 0 01-.659 1.591l-4.175 4.175a2.25 2.25 0 00-.659 1.591v1.5m-12.75 0l3.75 3.75m0 0l3.75-3.75m-3.75 3.75h9"
      />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <circle cx="12" cy="12" r="8.25" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5V12l3 1.75" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v10m0 0 4-4m-4 4-4-4M5 20h14" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 14V4m0 0 4 4m-4-4-4 4M5 20h14" />
    </svg>
  );
}

const STAT_GRID = 'grid gap-4 sm:grid-cols-2 xl:grid-cols-4';

function StatCardSkeleton({ withProgress = true }: { withProgress?: boolean }) {
  return (
    <Card padding="md" aria-hidden="true">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Skeleton variant="line" className="w-16" />
          <Skeleton variant="line" className="mt-2.5 h-6 w-24" />
          <Skeleton variant="line" className="mt-2 w-32" />
        </div>
        <Skeleton variant="circle" className="size-5" />
      </div>
      {withProgress ? (
        <Skeleton variant="block" className="mt-3 h-1.5 w-full rounded-full" />
      ) : null}
    </Card>
  );
}

interface SystemStatusCardsProps {
  status: SystemStatus | null;
  loading?: boolean;
}

export function SystemStatusCards({ status, loading }: SystemStatusCardsProps) {
  if (loading) {
    return (
      <div className={STAT_GRID}>
        {[...Array(4)].map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (!status) {
    return (
      <Card
        padding="lg"
        className="border-dashed text-center shadow-none"
      >
        <p className="text-sm text-surface-500 dark:text-surface-400">
          选择 VPS 并连接成功后，这里会显示 CPU、内存、磁盘与运行时长。
        </p>
      </Card>
    );
  }

  return (
    <div className={STAT_GRID}>
      <StatCard
        label="CPU 使用率"
        value={`${status.cpuPercent.toFixed(1)}%`}
        icon={<CpuIcon />}
        progress={status.cpuPercent}
      />
      <StatCard
        label="内存"
        value={`${(status.memoryUsed / 1024).toFixed(1)} GB`}
        subValue={`总计 ${(status.memoryTotal / 1024).toFixed(1)} GB`}
        icon={<MemoryIcon />}
        progress={status.memoryTotal > 0 ? (status.memoryUsed / status.memoryTotal) * 100 : 0}
      />
      <StatCard
        label="磁盘"
        value={`${(status.diskUsed / (1024 * 1024 * 1024)).toFixed(1)} GB`}
        subValue={`总计 ${(status.diskTotal / (1024 * 1024 * 1024)).toFixed(1)} GB`}
        icon={<DiskIcon />}
        progress={status.diskUsagePercent}
      />
      <StatCard
        label="运行时长"
        value={formatUptime(status.uptimeSeconds)}
        subValue="自上次启动以来"
        icon={<ClockIcon />}
      />
    </div>
  );
}

interface NetworkTrafficCardProps {
  bytesReceived: number;
  bytesSent: number;
  loading?: boolean;
}

export function NetworkTrafficCard({ bytesReceived, bytesSent, loading }: NetworkTrafficCardProps) {
  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCardSkeleton withProgress={false} />
        <StatCardSkeleton withProgress={false} />
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <StatCard
        label="累计下行"
        value={formatBytes(bytesReceived)}
        subValue="自统计起始以来接收"
        icon={
          <span className="text-info-500 dark:text-info-400">
            <DownloadIcon />
          </span>
        }
      />
      <StatCard
        label="累计上行"
        value={formatBytes(bytesSent)}
        subValue="自统计起始以来发送"
        icon={
          <span className="text-info-500 dark:text-info-400">
            <UploadIcon />
          </span>
        }
      />
    </div>
  );
}
