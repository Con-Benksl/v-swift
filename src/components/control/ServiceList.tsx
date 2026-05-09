import { ServiceStatus } from '../../ipc/control';

interface ServiceListProps {
  services: ServiceStatus[];
  loading?: boolean;
  onRestart: (protocol: string) => void;
  onStart: (protocol: string) => void;
  onStop: (protocol: string) => void;
  actionLoading?: string | null;
}

function protocolLabel(protocol: string) {
  if (protocol === 'vless-reality') return 'VLESS Reality';
  if (protocol === 'hysteria2') return 'Hysteria 2';
  return protocol;
}

function ServiceRow({
  service,
  onRestart,
  onStart,
  onStop,
  loading,
}: {
  service: ServiceStatus;
  onRestart: () => void;
  onStart: () => void;
  onStop: () => void;
  loading?: boolean;
}) {
  const isRunning = service.running && service.active;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-blue-200 hover:bg-blue-50/30 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <div
          className={`h-3 w-3 rounded-full ${
            isRunning ? 'animate-pulse bg-emerald-500' : 'bg-rose-500'
          }`}
        />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-semibold text-slate-950">{service.name}</h4>
            <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
              {protocolLabel(service.protocol)}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {service.port ? `端口 ${service.port} · ` : ''}
            {isRunning ? (
              <span className="text-emerald-600">运行中</span>
            ) : (
              <span className="text-rose-600">已停止</span>
            )}
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        {isRunning ? (
          <>
            <button
              type="button"
              onClick={onRestart}
              disabled={loading}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? '重启中...' : '重启'}
            </button>
            <button
              type="button"
              onClick={onStop}
              disabled={loading}
              className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:border-rose-300 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? '停止中...' : '停止'}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onStart}
            disabled={loading}
            className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? '启动中...' : '启动'}
          </button>
        )}
      </div>
    </div>
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
          <div
            key={i}
            className="animate-pulse rounded-2xl border border-slate-200 bg-slate-100 p-4"
          >
            <div className="flex items-center gap-4">
              <div className="h-3 w-3 rounded-full bg-slate-300" />
              <div>
                <div className="h-4 w-32 rounded bg-slate-300" />
                <div className="mt-2 h-3 w-24 rounded bg-slate-300" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (services.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
        <p className="text-sm text-slate-500">暂无服务</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {services.map((service) => (
        <ServiceRow
          key={service.protocol}
          service={service}
          onRestart={() => onRestart(service.protocol)}
          onStart={() => onStart(service.protocol)}
          onStop={() => onStop(service.protocol)}
          loading={actionLoading === service.protocol}
        />
      ))}
    </div>
  );
}
