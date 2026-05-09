import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ConnectionStatus,
  NetworkStats,
  ServiceStatus,
  SystemStatus,
  connectVps,
  disconnectVps,
  getNetworkStats,
  getServiceLogs,
  getAllServiceStatuses,
  getSystemStatus,
  restartService,
  startService,
  stopService,
} from '../ipc/control';
import { listVpsProfiles } from '../ipc';
import { VpsProfileSummary } from '../ipc/types';
import { SystemStatusCards, NetworkRateCard, ServiceList, LogViewer, VpsSelector } from '../components/control';

const REFRESH_INTERVAL = 30_000;

export default function ControlPanel() {
  const [searchParams] = useSearchParams();
  const [profiles, setProfiles] = useState<VpsProfileSummary[]>([]);
  const [selectedVpsId, setSelectedVpsId] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({ status: 'disconnected' });
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [networkStats, setNetworkStats] = useState<NetworkStats | null>(null);
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [loadingServices, setLoadingServices] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState('');
  const connectRequestIdRef = useRef(0);
  const selectedVpsIdRef = useRef<string | null>(null);
  const connectedVpsIdRef = useRef<string | null>(null);

  const loadProfiles = useCallback(async () => {
    try {
      const data = await listVpsProfiles();
      setProfiles(data);
      const vpsIdFromUrl = searchParams.get('vpsId');
      if (vpsIdFromUrl) {
        setSelectedVpsId(vpsIdFromUrl);
      } else if (data.length > 0 && !selectedVpsId) {
        setSelectedVpsId(data[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载 VPS 列表失败');
    } finally {
      setLoadingProfiles(false);
    }
  }, [selectedVpsId, searchParams]);

  useEffect(() => {
    selectedVpsIdRef.current = selectedVpsId;
  }, [selectedVpsId]);

  useEffect(() => {
    return () => {
      connectRequestIdRef.current += 1;
    };
  }, []);

  const connectAndLoadData = useCallback(async (vpsId: string) => {
    const requestId = connectRequestIdRef.current + 1;
    connectRequestIdRef.current = requestId;
    const isCurrentRequest = () =>
      connectRequestIdRef.current === requestId && selectedVpsIdRef.current === vpsId;

    setConnectionStatus({ status: 'connecting' });
    setSystemStatus(null);
    setNetworkStats(null);
    setServices([]);
    setLogs([]);

    const previousVpsId = connectedVpsIdRef.current;
    if (previousVpsId && previousVpsId !== vpsId) {
      try {
        await disconnectVps(previousVpsId);
      } catch {
      }
      if (connectedVpsIdRef.current === previousVpsId) {
        connectedVpsIdRef.current = null;
      }
    }

    if (!isCurrentRequest()) return;

    try {
      await connectVps(vpsId);
      if (!isCurrentRequest()) {
        return;
      }
      connectedVpsIdRef.current = vpsId;
      setConnectionStatus({ status: 'connected' });
    } catch (err) {
      if (!isCurrentRequest()) return;
      const msg = err instanceof Error ? err.message : '连接失败';
      setConnectionStatus({ status: 'error', message: msg });
      setError(msg);
      return;
    }

    setLoadingStatus(true);
    let loadedServices: ServiceStatus[] = [];
    try {
      const [sys, net, serviceStatuses] = await Promise.all([
        getSystemStatus(vpsId),
        getNetworkStats(vpsId),
        getAllServiceStatuses(vpsId),
      ]);
      if (!isCurrentRequest()) return;
      loadedServices = serviceStatuses;
      setSystemStatus(sys);
      setNetworkStats(net);
      setServices(serviceStatuses);
    } catch (err) {
      if (!isCurrentRequest()) return;
      setError(err instanceof Error ? err.message : '加载状态失败');
    } finally {
      if (isCurrentRequest()) {
        setLoadingStatus(false);
      }
    }

    if (loadedServices.length > 0 && isCurrentRequest()) {
      setLoadingLogs(true);
      try {
        const logLines = await getServiceLogs(vpsId, loadedServices[0].protocol);
        if (isCurrentRequest()) {
          setLogs(logLines);
        }
      } catch {
        if (isCurrentRequest()) {
          setLogs(['Failed to load logs']);
        }
      } finally {
        if (isCurrentRequest()) {
          setLoadingLogs(false);
        }
      }
    }
  }, []);

  const refreshData = useCallback(async () => {
    if (!selectedVpsId || connectionStatus.status !== 'connected') return;

    const vpsId = selectedVpsId;
    setLoadingStatus(true);
    try {
      const [sys, net] = await Promise.all([
        getSystemStatus(vpsId),
        getNetworkStats(vpsId),
      ]);
      if (selectedVpsIdRef.current !== vpsId) return;
      setSystemStatus(sys);
      setNetworkStats(net);
    } catch {
    } finally {
      if (selectedVpsIdRef.current === vpsId) {
        setLoadingStatus(false);
      }
    }
  }, [selectedVpsId, connectionStatus.status]);

  const refreshServices = useCallback(async () => {
    if (!selectedVpsId || connectionStatus.status !== 'connected') return;

    const vpsId = selectedVpsId;
    setLoadingServices(true);
    try {
      const svc = await getAllServiceStatuses(vpsId);
      if (selectedVpsIdRef.current !== vpsId) return;
      setServices(svc);
    } catch {
      if (selectedVpsIdRef.current === vpsId) {
        setServices([]);
      }
    } finally {
      if (selectedVpsIdRef.current === vpsId) {
        setLoadingServices(false);
      }
    }
  }, [selectedVpsId, connectionStatus.status]);

  const refreshLogs = useCallback(async (protocol?: string) => {
    if (!selectedVpsId || connectionStatus.status !== 'connected') return;

    const vpsId = selectedVpsId;
    const targetProtocol = protocol || (services.length > 0 ? services[0].protocol : 'vless-reality');

    setLoadingLogs(true);
    try {
      const logLines = await getServiceLogs(vpsId, targetProtocol);
      if (selectedVpsIdRef.current !== vpsId) return;
      setLogs(logLines);
    } catch {
      if (selectedVpsIdRef.current === vpsId) {
        setLogs(['Failed to load logs']);
      }
    } finally {
      if (selectedVpsIdRef.current === vpsId) {
        setLoadingLogs(false);
      }
    }
  }, [selectedVpsId, connectionStatus.status, services]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    if (!selectedVpsId) return;
    void connectAndLoadData(selectedVpsId);
  }, [selectedVpsId, connectAndLoadData]);

  useEffect(() => {
    if (!selectedVpsId || connectionStatus.status !== 'connected') return;

    const interval = setInterval(() => {
      void refreshData();
    }, REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, [selectedVpsId, connectionStatus.status, refreshData]);

  const handleServiceAction = async (
    action: 'restart' | 'start' | 'stop',
    protocol: string,
  ) => {
    if (!selectedVpsId) return;

    setActionLoading(protocol);
    try {
      if (action === 'restart') {
        await restartService(selectedVpsId, protocol);
      } else if (action === 'start') {
        await startService(selectedVpsId, protocol);
      } else {
        await stopService(selectedVpsId, protocol);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await refreshServices();
      await refreshLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setActionLoading(null);
    }
  };

  const connectionLabel = () => {
    if (connectionStatus.status === 'disconnected') return { text: '未连接', class: 'text-slate-500' };
    if (connectionStatus.status === 'connecting') return { text: '连接中...', class: 'text-amber-500' };
    if (connectionStatus.status === 'connected') return { text: '已连接', class: 'text-emerald-600' };
    if (connectionStatus.status === 'error') return { text: `错误: ${connectionStatus.message}`, class: 'text-rose-600' };
    return { text: '未知', class: 'text-slate-500' };
  };

  const conn = connectionLabel();

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(37,99,235,0.14),_transparent_38%),linear-gradient(180deg,_#f8fafc_0%,_#e2e8f0_100%)] px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <section className="rounded-[2rem] border border-white/60 bg-white/75 p-8 shadow-xl shadow-slate-300/30 backdrop-blur">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-600">控制面板</p>
              <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">VPS 管理</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
                实时监控 VPS 状态，管理服务运行。
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex items-center gap-3">
                <VpsSelector
                  profiles={profiles}
                  selectedId={selectedVpsId}
                  onSelect={setSelectedVpsId}
                  loading={loadingProfiles}
                />
                <span className={`text-sm font-medium ${conn.class}`}>{conn.text}</span>
              </div>
              <button
                type="button"
                onClick={() => void refreshData()}
                disabled={loadingStatus || connectionStatus.status !== 'connected'}
                className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
              >
                {loadingStatus ? '刷新中...' : '刷新'}
              </button>
            </div>
          </div>
        </section>

        {error && (
          <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {error}
            <button
              type="button"
              onClick={() => setError('')}
              className="ml-3 underline hover:no-underline"
            >
              关闭
            </button>
          </div>
        )}

        <div className="mt-8 space-y-6">
          <section>
            <h2 className="mb-4 text-lg font-semibold text-slate-950">系统状态</h2>
            <SystemStatusCards status={systemStatus} loading={loadingStatus} />
          </section>

          {networkStats && (
            <section>
              <h2 className="mb-4 text-lg font-semibold text-slate-950">流量统计</h2>
              <NetworkRateCard
                rxRateBps={networkStats.bytesReceived}
                txRateBps={networkStats.bytesSent}
                loading={loadingStatus}
              />
            </section>
          )}

          <section>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-950">服务管理</h2>
              <button
                type="button"
                onClick={() => void refreshServices()}
                disabled={loadingServices || connectionStatus.status !== 'connected'}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                刷新服务
              </button>
            </div>
            <ServiceList
              services={services}
              loading={loadingServices}
              onRestart={(p) => void handleServiceAction('restart', p)}
              onStart={(p) => void handleServiceAction('start', p)}
              onStop={(p) => void handleServiceAction('stop', p)}
              actionLoading={actionLoading}
            />
          </section>

          <section>
            <h2 className="mb-4 text-lg font-semibold text-slate-950">日志</h2>
            <LogViewer
              logs={logs}
              loading={loadingLogs}
              onRefresh={() => void refreshLogs()}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
