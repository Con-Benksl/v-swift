import { ServiceStatus } from '../../ipc/control';
import { protocolLabel } from '../../lib';
import { Badge, Button, Card, Skeleton, Spinner } from '../ui';

interface ServiceListProps {
  services: ServiceStatus[];
  loading?: boolean;
  onRestart: (protocol: string) => void;
  onStart: (protocol: string) => void;
  onStop: (protocol: string) => void;
  /** 正在执行操作的服务协议 id；非空期间整表按钮互斥禁用 */
  actionLoading?: string | null;
}

function ServiceRow({
  service,
  onRestart,
  onStart,
  onStop,
  busy,
  acting,
}: {
  service: ServiceStatus;
  onRestart: () => void;
  onStart: () => void;
  onStop: () => void;
  /** 整表互斥：任意服务操作期间为 true，禁用所有行按钮 */
  busy: boolean;
  /** 当前行是否为正在操作的目标行 */
  acting: boolean;
}) {
  const isRunning = service.running && service.active;

  return (
    <Card padding="md" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="truncate font-semibold text-surface-800 dark:text-surface-100">
              {service.name}
            </h4>
            <Badge variant="info">{protocolLabel(service.protocol)}</Badge>
            {isRunning ? (
              <Badge variant="success" dot pulse>
                运行中
              </Badge>
            ) : (
              <Badge variant="danger" dot>
                已停止
              </Badge>
            )}
          </div>
          <p className="mt-1.5 text-xs text-surface-500 dark:text-surface-400">
            {service.port ? `端口 ${service.port}` : '端口未记录'}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {acting ? (
          <span className="inline-flex items-center gap-1.5 pr-1 text-xs text-surface-500 dark:text-surface-400">
            <Spinner size="sm" />
            处理中…
          </span>
        ) : null}
        {isRunning ? (
          <>
            <Button variant="secondary" size="sm" onClick={onRestart} disabled={busy}>
              重启
            </Button>
            <Button variant="danger" size="sm" onClick={onStop} disabled={busy}>
              停止
            </Button>
          </>
        ) : (
          <Button variant="secondary" size="sm" onClick={onStart} disabled={busy}>
            启动
          </Button>
        )}
      </div>
    </Card>
  );
}

function ServiceRowSkeleton() {
  return (
    <Card padding="md" aria-hidden="true">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Skeleton variant="line" className="w-28" />
            <Skeleton variant="block" className="h-5 w-20 rounded-full" />
          </div>
          <Skeleton variant="line" className="mt-2.5 w-24" />
        </div>
        <Skeleton variant="block" className="h-7 w-14" />
      </div>
    </Card>
  );
}

export function ServiceList({
  services,
  loading,
  onRestart,
  onStart,
  onStop,
  actionLoading,
}: ServiceListProps) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(2)].map((_, i) => (
          <ServiceRowSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (services.length === 0) {
    return (
      <Card padding="lg" className="border-dashed text-center shadow-none">
        <p className="text-sm font-medium text-surface-600 dark:text-surface-300">暂无服务</p>
        <p className="mt-1.5 text-xs leading-relaxed text-surface-500 dark:text-surface-400">
          连接成功后会自动列出该 VPS 上已部署的代理服务；
          <br />
          若刚刚完成部署，点击右上角「刷新服务」获取最新状态。
        </p>
      </Card>
    );
  }

  const busy = Boolean(actionLoading);

  return (
    <div className="space-y-3">
      {services.map((service) => (
        <ServiceRow
          key={service.protocol}
          service={service}
          onRestart={() => onRestart(service.protocol)}
          onStart={() => onStart(service.protocol)}
          onStop={() => onStop(service.protocol)}
          busy={busy}
          acting={actionLoading === service.protocol}
        />
      ))}
    </div>
  );
}
