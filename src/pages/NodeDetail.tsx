import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import SubscriptionView from '../components/SubscriptionView';
import {
  Badge,
  Button,
  Callout,
  Card,
  Modal,
  PageShell,
  SectionHeader,
  Skeleton,
  SkeletonText,
  StatCard,
  useToast,
} from '../components/ui';
import { getNode, getSubscription, uninstallNode } from '../ipc';
import { NodeRecord, SubscriptionResult } from '../ipc/types';
import {
  extractErrorMessage,
  extractPort,
  formatAbsoluteTime,
  protocolLabel,
  statusLabel,
} from '../lib';
import { useDeploymentActivity } from '../lib/deploymentActivity';

/** 节点状态 → Badge 语义变体（与列表页同一表达：同一数据同一呈现） */
function statusBadgeVariant(status: NodeRecord['status']): 'success' | 'danger' | 'neutral' {
  if (status === 'active') return 'success';
  if (status === 'uninstalled') return 'danger';
  return 'neutral';
}

/** 返回图标（内联极简 stroke SVG） */
function ArrowLeftIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-4 w-4"
    >
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}

/** 与 StatCard 实物同布局的指标卡骨架 */
function StatCardSkeleton() {
  return (
    <Card padding="md" aria-hidden="true">
      <Skeleton variant="line" className="w-14" />
      <Skeleton variant="line" className="mt-2.5 h-6 w-24" />
    </Card>
  );
}

export default function NodeDetail() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const {
    acquire: acquireDeploymentActivity,
    release: releaseDeploymentActivity,
  } = useDeploymentActivity();
  const [node, setNode] = useState<NodeRecord | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionResult | null>(null);
  const [nodeLoading, setNodeLoading] = useState(true);
  const [nodeError, setNodeError] = useState('');
  const [nodeReloadTick, setNodeReloadTick] = useState(0);
  const [subscriptionLoading, setSubscriptionLoading] = useState(true);
  const [subscriptionError, setSubscriptionError] = useState('');
  const [subscriptionReloadTick, setSubscriptionReloadTick] = useState(0);
  const [pendingUninstall, setPendingUninstall] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [uninstalling, setUninstalling] = useState(false);
  const [uninstallError, setUninstallError] = useState('');
  const mountedRef = useRef(false);
  const currentNodeIdRef = useRef(id);
  const uninstallRequestIdRef = useRef(0);
  const uninstallInFlightRef = useRef(false);

  currentNodeIdRef.current = id;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      uninstallRequestIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!id) {
      setNode(null);
      setNodeError(t('nodeDetail.missingNodeId'));
      setNodeLoading(false);
      return;
    }

    let cancelled = false;
    setNode(null);
    setNodeLoading(true);
    setNodeError('');

    void getNode(id)
      .then((record) => {
        if (cancelled) {
          return;
        }

        setNode(record);
      })
      .catch((err) => {
        if (!cancelled) {
          setNodeError(extractErrorMessage(err, t('nodeDetail.loadNodeFailed')));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setNodeLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id, nodeReloadTick]);

  useEffect(() => {
    if (!id) {
      setSubscription(null);
      setSubscriptionError(t('nodeDetail.missingNodeId'));
      setSubscriptionLoading(false);
      return;
    }

    let cancelled = false;
    setSubscription(null);
    setSubscriptionLoading(true);
    setSubscriptionError('');

    void getSubscription(id)
      .then((result) => {
        if (!cancelled) {
          setSubscription(result);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setSubscriptionError(extractErrorMessage(err, t('nodeDetail.loadSubscriptionFailed')));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSubscriptionLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id, subscriptionReloadTick]);

  useEffect(() => {
    if (!uninstalling) {
      setPendingUninstall((current) => (current?.id === id ? current : null));
    }
  }, [id, uninstalling]);

  const openConfirm = () => {
    const target = node?.id === id ? node : null;
    if (!target) return;
    setUninstallError('');
    setPendingUninstall({ id: target.id, name: target.name });
  };

  const closeConfirm = () => {
    if (uninstalling) {
      return;
    }
    setPendingUninstall(null);
    setUninstallError('');
  };

  const handleUninstall = () => {
    const target = pendingUninstall;
    if (!target || uninstallInFlightRef.current) {
      return;
    }

    const requestId = uninstallRequestIdRef.current + 1;
    uninstallRequestIdRef.current = requestId;
    const isCurrentRequest = () =>
      mountedRef.current &&
      uninstallRequestIdRef.current === requestId &&
      currentNodeIdRef.current === target.id;
    const activityLease = acquireDeploymentActivity();
    uninstallInFlightRef.current = true;
    setUninstalling(true);
    setUninstallError('');

    void uninstallNode(target.id)
      .then((outcome) => {
        if (!isCurrentRequest()) {
          return;
        }
        if (outcome.warnings.length > 0) {
          toast.info(outcome.warnings.join('；'), { duration: 7000 });
        } else {
          toast.success(t('nodeDetail.uninstallSuccess'));
        }
        navigate('/');
      })
      .catch((err) => {
        if (isCurrentRequest()) {
          setUninstallError(extractErrorMessage(err, t('nodeDetail.uninstallFailed')));
          // Backend may deliberately preserve a retryable `unknown` record after a partial
          // remote uninstall. Reload so the page does not keep presenting stale "active" state.
          setNodeReloadTick((value) => value + 1);
        }
      })
      .finally(() => {
        releaseDeploymentActivity(activityLease);
        if (uninstallRequestIdRef.current === requestId) {
          uninstallInFlightRef.current = false;
        }
        if (isCurrentRequest()) {
          setUninstalling(false);
        }
      });
  };

  const currentNode = node?.id === id ? node : null;
  const port = currentNode ? extractPort(currentNode) : undefined;

  return (
    <PageShell width="lg">
      <SectionHeader
        eyebrow={t('nodeDetail.eyebrow')}
        title={currentNode?.name ?? t('nodeDetail.eyebrow')}
        description={
          currentNode
            ? `${currentNode.vpsName} · ${currentNode.host}:${currentNode.sshPort} · ${protocolLabel(currentNode.protocol)}`
            : nodeLoading
              ? t('nodeDetail.loadingDescription')
              : undefined
        }
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate('/')} disabled={uninstalling}>
              <ArrowLeftIcon />
              {t('nodeDetail.backToList')}
            </Button>
            <Button
              variant="danger"
              onClick={openConfirm}
              disabled={!currentNode || uninstalling}
            >
              {t('nodeDetail.uninstallNode')}
            </Button>
          </>
        }
      />

      {/* 加载 / 错误 / 成功三态共享同一容器结构，消除跳动 */}
      <div className="mt-6">
        {nodeError && !nodeLoading ? (
          <Callout variant="danger" title={t('nodeDetail.loadNodeFailed')}>
            <p>{nodeError}</p>
            <div className="mt-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setNodeReloadTick((value) => value + 1)}
              >
                {t('nodeDetail.retry')}
              </Button>
            </div>
          </Callout>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              {nodeLoading || !currentNode ? (
                <>
                  <StatCardSkeleton />
                  <StatCardSkeleton />
                  <StatCardSkeleton />
                  <StatCardSkeleton />
                  <StatCardSkeleton />
                </>
              ) : (
                <>
                  <StatCard
                    label={t('nodeDetail.statStatus')}
                    value={
                      <Badge variant={statusBadgeVariant(currentNode.status)} dot>
                        {statusLabel(currentNode.status)}
                      </Badge>
                    }
                  />
                  <StatCard label={t('nodeDetail.statVpsName')} value={currentNode.vpsName} />
                  <StatCard
                    label={t('nodeDetail.statSshLogin')}
                    value={currentNode.sshUser}
                    subValue={`${currentNode.host}:${currentNode.sshPort}`}
                  />
                  <StatCard
                    label={t('nodeDetail.statProtocolPort')}
                    value={port !== undefined ? String(port) : t('nodeDetail.portNotRecorded')}
                  />
                  <StatCard label={t('nodeDetail.statCreatedAt')} value={formatAbsoluteTime(currentNode.createdAt)} />
                </>
              )}
            </div>

            <div className="mt-6">
              {nodeLoading || !currentNode ? (
                <Card padding="lg">
                  <div className="space-y-4" aria-hidden="true">
                    <Skeleton variant="line" className="h-6 w-40" />
                    <SkeletonText lines={3} />
                    <Skeleton variant="block" className="h-40 w-full" />
                  </div>
                </Card>
              ) : subscriptionLoading ? (
                <Card padding="lg">
                  <div className="space-y-4" aria-hidden="true">
                    <Skeleton variant="line" className="h-6 w-40" />
                    <SkeletonText lines={3} />
                    <Skeleton variant="block" className="h-40 w-full" />
                  </div>
                </Card>
              ) : subscriptionError ? (
                <Callout variant="danger" title={t('nodeDetail.subscriptionLoadFailed')}>
                  <p>{subscriptionError}</p>
                  <p className="mt-2 text-xs opacity-80">
                    {t('nodeDetail.subscriptionRetryHint')}
                  </p>
                  <div className="mt-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setSubscriptionReloadTick((value) => value + 1)}
                    >
                      {t('nodeDetail.retrySubscription')}
                    </Button>
                  </div>
                </Callout>
              ) : subscription ? (
                <SubscriptionView
                  node={currentNode}
                  uri={subscription.uri}
                  qrSvg={subscription.qrSvg}
                  managedUri={subscription.managedUri}
                  managedQrSvg={subscription.managedQrSvg}
                />
              ) : (
                <Callout variant="danger" title={t('nodeDetail.subscriptionUnavailable')}>
                  {t('nodeDetail.subscriptionUnavailableHint')}
                </Callout>
              )}
            </div>
          </>
        )}
      </div>

      <Modal
        open={pendingUninstall !== null}
        onClose={closeConfirm}
        title={t('nodeDetail.uninstallConfirmTitle')}
        size="sm"
        closeOnOverlayClick={!uninstalling}
        closeOnEsc={!uninstalling}
        showCloseButton={!uninstalling}
        footer={
          <>
            <Button variant="secondary" onClick={closeConfirm} disabled={uninstalling}>
              {t('nodeDetail.cancel')}
            </Button>
            <Button
              variant="danger"
              onClick={handleUninstall}
              loading={uninstalling}
              loadingText={t('nodeDetail.uninstalling')}
            >
              {t('nodeDetail.confirmUninstall')}
            </Button>
          </>
        }
      >
        <p>
          {t('nodeDetail.uninstallConfirmBody', { name: pendingUninstall?.name ?? '' })}
        </p>
        {uninstallError ? (
          <Callout variant="danger" title={t('nodeDetail.uninstallFailed')} className="mt-3">
            {uninstallError}
          </Callout>
        ) : null}
      </Modal>
    </PageShell>
  );
}
