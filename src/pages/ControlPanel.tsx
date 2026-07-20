import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
import { extractIpcErrorMessage } from '../ipc/errors';
import { VpsProfileSummary } from '../ipc/types';
import { protocolLabel } from '../lib';
import { useDeploymentActivity } from '../lib/deploymentActivity';
import {
  Badge,
  Button,
  Callout,
  Card,
  Modal,
  PageShell,
  SectionHeader,
} from '../components/ui';
import {
  SystemStatusCards,
  NetworkTrafficCard,
  ServiceList,
  LogViewer,
  VpsSelector,
} from '../components/control';

const REFRESH_INTERVAL = 30_000;

/** 连接状态徽章：色点 + 文字，错误详情不进徽章（统一由 Callout 单处展示） */
function ConnectionStatusBadge({ status }: { status: ConnectionStatus }) {
  if (status.status === 'connected') {
    return (
      <Badge variant="success" dot>
        已连接
      </Badge>
    );
  }
  if (status.status === 'connecting') {
    return (
      <Badge variant="warning" dot>
        连接中…
      </Badge>
    );
  }
  if (status.status === 'error') {
    return (
      <Badge variant="danger" dot>
        连接错误
      </Badge>
    );
  }
  return (
    <Badge variant="neutral" dot>
      未连接
    </Badge>
  );
}

export default function ControlPanel() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const vpsIdFromUrl = searchParams.get('vpsId');
  const {
    acquire: acquireDeploymentActivity,
    release: releaseDeploymentActivity,
  } = useDeploymentActivity();
  const [profiles, setProfiles] = useState<VpsProfileSummary[]>([]);
  const [selectedVpsId, setSelectedVpsId] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({ status: 'disconnected' });
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [networkStats, setNetworkStats] = useState<NetworkStats | null>(null);
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [logProtocol, setLogProtocol] = useState('');
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [loadingServices, setLoadingServices] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [pendingStop, setPendingStop] = useState<{ vpsId: string; protocol: string } | null>(null);
  const [error, setError] = useState('');
  const connectRequestIdRef = useRef(0);
  const statusRequestIdRef = useRef(0);
  const serviceRequestIdRef = useRef(0);
  const logRequestIdRef = useRef(0);
  const logProtocolRef = useRef('');
  const selectedVpsIdRef = useRef<string | null>(null);
  const connectedVpsIdRef = useRef<string | null>(null);
  const connectionTransitionRef = useRef<Promise<void>>(Promise.resolve());
  const actionInFlightRef = useRef(false);
  const mountedRef = useRef(false);
  const profileLoadRequestIdRef = useRef(0);
  const actionRequestIdRef = useRef(0);

  const loadProfiles = useCallback(async () => {
    const requestId = profileLoadRequestIdRef.current + 1;
    profileLoadRequestIdRef.current = requestId;
    const isCurrentRequest = () =>
      mountedRef.current && profileLoadRequestIdRef.current === requestId;

    setLoadingProfiles(true);
    try {
      const data = await listVpsProfiles();
      if (!isCurrentRequest()) return;

      const availableProfiles = data.filter((profile) => profile.credentialAvailable);
      const availableProfileIds = new Set(availableProfiles.map((profile) => profile.id));
      setProfiles(availableProfiles);
      setSelectedVpsId((current) => {
        if (vpsIdFromUrl && availableProfileIds.has(vpsIdFromUrl)) return vpsIdFromUrl;
        if (current && availableProfileIds.has(current)) return current;
        return availableProfiles[0]?.id ?? null;
      });
    } catch (err) {
      if (isCurrentRequest()) {
        setError(extractIpcErrorMessage(err, '加载 VPS 列表失败'));
      }
    } finally {
      if (isCurrentRequest()) {
        setLoadingProfiles(false);
      }
    }
  }, [vpsIdFromUrl]);

  useEffect(() => {
    selectedVpsIdRef.current = selectedVpsId;
  }, [selectedVpsId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      profileLoadRequestIdRef.current += 1;
      connectRequestIdRef.current += 1;
      statusRequestIdRef.current += 1;
      serviceRequestIdRef.current += 1;
      logRequestIdRef.current += 1;
      actionRequestIdRef.current += 1;
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
    setLogProtocol('');
    setLoadingStatus(false);
    setLoadingServices(false);
    setLoadingLogs(false);
    statusRequestIdRef.current += 1;
    serviceRequestIdRef.current += 1;
    logProtocolRef.current = '';
    logRequestIdRef.current += 1;

    const transition = connectionTransitionRef.current
      .catch(() => undefined)
      .then(async () => {
        if (!isCurrentRequest()) return false;

        const previousVpsId = connectedVpsIdRef.current;
        if (previousVpsId && previousVpsId !== vpsId) {
          try {
            await disconnectVps(previousVpsId);
          } catch {
            // 后续 connect 会给出当前目标的真实状态；断开旧缓存失败不覆盖它。
          }
          if (connectedVpsIdRef.current === previousVpsId) {
            connectedVpsIdRef.current = null;
          }
        }

        if (!isCurrentRequest()) return false;

        try {
          await connectVps(vpsId);
        } catch (err) {
          if (isCurrentRequest()) {
            const msg = extractIpcErrorMessage(err, '连接失败');
            setConnectionStatus({ status: 'error', message: msg });
            setError(msg);
          }
          return false;
        }

        // 连接池按 VPS ID 而不是请求会话标识；过期请求不能断开可能已被新请求复用的连接。
        if (!isCurrentRequest()) return false;

        connectedVpsIdRef.current = vpsId;
        return true;
      });

    connectionTransitionRef.current = transition.then(() => undefined, () => undefined);
    if (!(await transition)) return;
    setConnectionStatus({ status: 'connected' });

    const statusRequestId = statusRequestIdRef.current + 1;
    statusRequestIdRef.current = statusRequestId;
    const serviceRequestId = serviceRequestIdRef.current + 1;
    serviceRequestIdRef.current = serviceRequestId;
    const isCurrentStatusRequest = () =>
      isCurrentRequest() && statusRequestIdRef.current === statusRequestId;
    const isCurrentServiceRequest = () =>
      isCurrentRequest() && serviceRequestIdRef.current === serviceRequestId;

    setLoadingStatus(true);
    setLoadingServices(true);
    const statusPromise = Promise.all([getSystemStatus(vpsId), getNetworkStats(vpsId)]);
    const servicesPromise = getAllServiceStatuses(vpsId).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    let loadedServices: ServiceStatus[] = [];

    try {
      const [sys, net] = await statusPromise;
      if (isCurrentStatusRequest()) {
        setSystemStatus(sys);
        setNetworkStats(net);
      }
    } catch (err) {
      if (isCurrentStatusRequest()) {
        setError(extractIpcErrorMessage(err, '加载状态失败'));
      }
    } finally {
      if (isCurrentStatusRequest()) {
        setLoadingStatus(false);
      }
    }

    try {
      const serviceResult = await servicesPromise;
      if (!serviceResult.ok) throw serviceResult.error;
      const serviceStatuses = serviceResult.value;
      if (isCurrentServiceRequest()) {
        loadedServices = serviceStatuses;
        setServices(serviceStatuses);
      }
    } catch (err) {
      if (isCurrentServiceRequest()) {
        setError(extractIpcErrorMessage(err, '加载服务状态失败'));
      }
    } finally {
      if (isCurrentServiceRequest()) {
        setLoadingServices(false);
      }
    }

    if (loadedServices.length > 0 && isCurrentServiceRequest()) {
      const initialProtocol = loadedServices[0].protocol;
      const logRequestId = logRequestIdRef.current + 1;
      logRequestIdRef.current = logRequestId;
      logProtocolRef.current = initialProtocol;
      const isCurrentLogRequest = () =>
        isCurrentRequest() &&
        logRequestIdRef.current === logRequestId &&
        logProtocolRef.current === initialProtocol;

      setLogProtocol(initialProtocol);
      setLoadingLogs(true);
      try {
        const logLines = await getServiceLogs(vpsId, initialProtocol);
        if (isCurrentLogRequest()) {
          setLogs(logLines);
        }
      } catch (err) {
        if (isCurrentLogRequest()) {
          const msg = extractIpcErrorMessage(err, '加载日志失败');
          setLogs([msg]);
          setError(msg);
        }
      } finally {
        if (isCurrentLogRequest()) {
          setLoadingLogs(false);
        }
      }
    }
  }, []);

  const refreshData = useCallback(async () => {
    if (!selectedVpsId || connectionStatus.status !== 'connected') return;

    const vpsId = selectedVpsId;
    const requestId = statusRequestIdRef.current + 1;
    statusRequestIdRef.current = requestId;
    const isCurrentRequest = () =>
      selectedVpsIdRef.current === vpsId && statusRequestIdRef.current === requestId;
    setLoadingStatus(true);
    try {
      const [sys, net] = await Promise.all([
        getSystemStatus(vpsId),
        getNetworkStats(vpsId),
      ]);
      if (!isCurrentRequest()) return;
      setSystemStatus(sys);
      setNetworkStats(net);
    } catch (err) {
      if (isCurrentRequest()) {
        setError(extractIpcErrorMessage(err, '加载状态失败'));
      }
    } finally {
      if (isCurrentRequest()) {
        setLoadingStatus(false);
      }
    }
  }, [selectedVpsId, connectionStatus.status]);

  const refreshServices = useCallback(async () => {
    if (!selectedVpsId || connectionStatus.status !== 'connected') return;

    const vpsId = selectedVpsId;
    const requestId = serviceRequestIdRef.current + 1;
    serviceRequestIdRef.current = requestId;
    const isCurrentRequest = () =>
      selectedVpsIdRef.current === vpsId && serviceRequestIdRef.current === requestId;
    setLoadingServices(true);
    try {
      const svc = await getAllServiceStatuses(vpsId);
      if (!isCurrentRequest()) return;
      setServices(svc);
    } catch (err) {
      if (isCurrentRequest()) {
        setServices([]);
        setError(extractIpcErrorMessage(err, '加载服务状态失败'));
      }
    } finally {
      if (isCurrentRequest()) {
        setLoadingServices(false);
      }
    }
  }, [selectedVpsId, connectionStatus.status]);

  const refreshLogs = useCallback(async (protocol?: string) => {
    if (!selectedVpsId || connectionStatus.status !== 'connected') return;

    const vpsId = selectedVpsId;
    if (selectedVpsIdRef.current !== vpsId) return;

    const targetProtocol =
      protocol ||
      logProtocolRef.current ||
      (services.length > 0 ? services[0].protocol : 'vless-reality');
    const requestId = logRequestIdRef.current + 1;
    logRequestIdRef.current = requestId;
    logProtocolRef.current = targetProtocol;
    const isCurrentLogRequest = () =>
      selectedVpsIdRef.current === vpsId &&
      logRequestIdRef.current === requestId &&
      logProtocolRef.current === targetProtocol;

    setLoadingLogs(true);
    try {
      const logLines = await getServiceLogs(vpsId, targetProtocol);
      if (!isCurrentLogRequest()) return;
      setLogs(logLines);
    } catch (err) {
      if (isCurrentLogRequest()) {
        const msg = extractIpcErrorMessage(err, '加载日志失败');
        setLogs([msg]);
        setError(msg);
      }
    } finally {
      if (isCurrentLogRequest()) {
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
    targetVpsId: string | null = selectedVpsId,
  ): Promise<boolean> => {
    if (!targetVpsId || actionInFlightRef.current) return false;

    const requestId = actionRequestIdRef.current + 1;
    actionRequestIdRef.current = requestId;
    const isCurrentAction = () =>
      mountedRef.current && actionRequestIdRef.current === requestId;
    const activityLease = acquireDeploymentActivity();
    actionInFlightRef.current = true;
    setActionLoading(protocol);
    try {
      if (action === 'restart') {
        await restartService(targetVpsId, protocol);
      } else if (action === 'start') {
        await startService(targetVpsId, protocol);
      } else {
        await stopService(targetVpsId, protocol);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (selectedVpsIdRef.current === targetVpsId) {
        await refreshServices();
        await refreshLogs(logProtocolRef.current || protocol);
      }
      return isCurrentAction();
    } catch (err) {
      if (isCurrentAction() && selectedVpsIdRef.current === targetVpsId) {
        setError(extractIpcErrorMessage(err, '操作失败'));
      }
      return false;
    } finally {
      releaseDeploymentActivity(activityLease);
      if (isCurrentAction()) {
        setActionLoading(null);
        actionInFlightRef.current = false;
      }
    }
  };

  const handleLogProtocolChange = (protocol: string) => {
    logProtocolRef.current = protocol;
    setLogProtocol(protocol);
    void refreshLogs(protocol);
  };

  const requestStopService = (protocol: string) => {
    const vpsId = selectedVpsIdRef.current;
    if (vpsId) {
      setPendingStop({ vpsId, protocol });
    }
  };

  const closeStopConfirm = () => {
    if (pendingStop && actionLoading === pendingStop.protocol) {
      return;
    }
    setPendingStop(null);
  };

  const confirmStopService = async () => {
    const target = pendingStop;
    if (!target) return;

    const stopped = await handleServiceAction('stop', target.protocol, target.vpsId);
    if (stopped) {
      setPendingStop((current) =>
        current?.vpsId === target.vpsId && current.protocol === target.protocol ? null : current,
      );
    }
  };

  const connected = connectionStatus.status === 'connected';
  const hasProfiles = profiles.length > 0;
  const stopInProgress = Boolean(pendingStop && actionLoading === pendingStop.protocol);
  const pendingStopVpsName = pendingStop
    ? (profiles.find((profile) => profile.id === pendingStop.vpsId)?.name ?? pendingStop.vpsId)
    : '';

  return (
    <PageShell width="xl">
      <SectionHeader
        eyebrow="控制面板"
        title="VPS 管理"
        description="实时监控 VPS 状态，管理服务运行。"
        actions={
          <>
            <ConnectionStatusBadge status={connectionStatus} />
            <VpsSelector
              profiles={profiles}
              selectedId={selectedVpsId}
              onSelect={setSelectedVpsId}
              loading={loadingProfiles}
              disabled={actionLoading !== null}
            />
            <Button
              variant="secondary"
              onClick={() => void refreshData()}
              loading={loadingStatus}
              loadingText="刷新中…"
              disabled={!connected}
            >
              刷新
            </Button>
          </>
        }
      />

      {error && (
        <Callout
          key={error}
          variant="danger"
          title="操作未成功"
          closable
          onClose={() => setError('')}
          className="mt-4"
        >
          {error}
        </Callout>
      )}

      {!loadingProfiles && !hasProfiles ? (
        <Card padding="lg" className="mt-6 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5.25 14.25h13.5m-13.5 0a2.25 2.25 0 0 1-2.25-2.25V6a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 6v6a2.25 2.25 0 0 1-2.25 2.25m-13.5 0v3A2.25 2.25 0 0 0 7.5 19.5h9a2.25 2.25 0 0 0 2.25-2.25v-3M9 9h.008v.008H9V9Zm0 6h.008v.008H9V15Z"
              />
            </svg>
          </div>
          <h2 className="mt-4 text-base font-semibold text-surface-800 dark:text-surface-100">
            还没有可用的 VPS 节点
          </h2>
          <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-surface-500 dark:text-surface-400">
            控制面板需要连接一个已部署的 VPS 才能展示系统状态与服务。
            先去新建一个节点，完成部署后回到这里管理。
          </p>
          <div className="mt-5">
            <Button variant="primary" onClick={() => navigate('/new')}>
              去新建节点
            </Button>
          </div>
        </Card>
      ) : (
        <div className="mt-6 space-y-6">
          <section>
            <h2 className="mb-3 text-sm font-semibold text-surface-800 dark:text-surface-100">
              系统状态
            </h2>
            <SystemStatusCards status={systemStatus} loading={loadingStatus} />
          </section>

          {networkStats && (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-surface-800 dark:text-surface-100">
                流量统计
              </h2>
              <NetworkTrafficCard
                bytesReceived={networkStats.bytesReceived}
                bytesSent={networkStats.bytesSent}
                loading={loadingStatus}
              />
            </section>
          )}

          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-100">
                服务管理
              </h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void refreshServices()}
                loading={loadingServices}
                loadingText="刷新中…"
                disabled={!connected}
              >
                刷新服务
              </Button>
            </div>
            <ServiceList
              services={services}
              loading={loadingServices}
              onRestart={(p) => void handleServiceAction('restart', p)}
              onStart={(p) => void handleServiceAction('start', p)}
              onStop={requestStopService}
              actionLoading={actionLoading}
            />
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-surface-800 dark:text-surface-100">
              日志
            </h2>
            <LogViewer
              logs={logs}
              loading={loadingLogs}
              onRefresh={() => void refreshLogs()}
              protocolOptions={services.map((s) => ({
                value: s.protocol,
                label: protocolLabel(s.protocol),
              }))}
              activeProtocol={logProtocol}
              onProtocolChange={handleLogProtocolChange}
            />
          </section>
        </div>
      )}

      <Modal
        open={pendingStop !== null}
        onClose={closeStopConfirm}
        title="确认停止服务？"
        description="停止后，使用该协议的客户端连接会立即中断。"
        size="sm"
        closeOnOverlayClick={!stopInProgress}
        closeOnEsc={!stopInProgress}
        showCloseButton={!stopInProgress}
        footer={
          <>
            <Button variant="secondary" onClick={closeStopConfirm} disabled={stopInProgress}>
              取消
            </Button>
            <Button
              variant="danger"
              onClick={() => void confirmStopService()}
              loading={stopInProgress}
              loadingText="停止中…"
            >
              确认停止
            </Button>
          </>
        }
      >
        {pendingStop ? (
          <p>
            将停止 VPS「{pendingStopVpsName}」上的 {protocolLabel(pendingStop.protocol)} 服务。
            此操作不会卸载节点，但会中断当前连接，之后可从服务列表重新启动。
          </p>
        ) : null}
      </Modal>
    </PageShell>
  );
}
