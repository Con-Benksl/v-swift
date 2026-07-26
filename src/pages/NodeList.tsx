import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import UpdateControl from '../components/UpdateControl';
import {
  Badge,
  Button,
  Callout,
  Card,
  Field,
  PageShell,
  SectionHeader,
  Skeleton,
  inputClass,
} from '../components/ui';
import { listNodes, updateVpsProfileHost } from '../ipc';
import { NodeRecord } from '../ipc/types';
import {
  extractErrorMessage,
  extractPort,
  formatRelativeTime,
  normalizeTimestamp,
  protocolLabel,
  statusLabel,
} from '../lib';
import { useDeploymentActivity } from '../lib/deploymentActivity';

interface VpsNodeGroup {
  id: string;
  vpsName: string;
  host: string;
  sshPort: number;
  sshUser: string;
  latestCreatedAt: number;
  nodes: NodeRecord[];
}

/** 节点状态 → Badge 语义变体（与详情页同一表达：同一数据同一呈现） */
function statusBadgeVariant(status: NodeRecord['status']): 'success' | 'danger' | 'neutral' {
  if (status === 'active') return 'success';
  if (status === 'uninstalled') return 'danger';
  return 'neutral';
}

/** 空态引导图标：服务器轮廓 + 加号（内联极简 stroke SVG） */
function EmptyServerIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-7 w-7"
    >
      <rect x="3" y="4" width="18" height="6" rx="1.5" />
      <rect x="3" y="14" width="18" height="6" rx="1.5" />
      <path d="M7 7h.01" />
      <path d="M7 17h.01" />
      <path d="M17 12v4" />
      <path d="M15 14h4" />
    </svg>
  );
}

/** 详情跳转 chevron（内联极简 stroke SVG） */
function ChevronRightIcon() {
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
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

/** 与实物同布局的骨架屏：VPS 组卡（头 + 节点行） */
function GroupSkeleton() {
  return (
    <Card padding="lg" aria-hidden="true">
      <div className="flex flex-col gap-4 border-b border-surface-border pb-5 dark:border-surface-700 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <Skeleton variant="line" className="h-6 w-44" />
          <Skeleton variant="line" className="w-64" />
        </div>
        <div className="flex items-center gap-3">
          <Skeleton variant="block" className="h-14 w-36" />
          <Skeleton variant="block" className="h-14 w-36" />
        </div>
      </div>
      <div className="mt-5 grid gap-3">
        <Skeleton variant="block" className="h-24 w-full" />
        <Skeleton variant="block" className="h-24 w-full" />
      </div>
    </Card>
  );
}

export default function NodeList() {
  const navigate = useNavigate();
  const {
    active: deploymentActive,
    acquire: acquireDeploymentActivity,
    release: releaseDeploymentActivity,
  } = useDeploymentActivity();
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);
  const [editingVpsId, setEditingVpsId] = useState<string | null>(null);
  const [editingHost, setEditingHost] = useState('');
  const [hostUpdateState, setHostUpdateState] = useState<'idle' | 'saving' | 'err'>('idle');
  const [hostUpdateError, setHostUpdateError] = useState('');
  const hostUpdateInFlightRef = useRef(false);

  const vpsId = useCallback(
    (group: VpsNodeGroup) =>
      group.id,
    [],
  );

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError('');

    void listNodes()
      .then((records) => {
        if (cancelled) {
          return;
        }

        setNodes(
          [...records].sort(
            (a, b) => normalizeTimestamp(b.createdAt) - normalizeTimestamp(a.createdAt),
          ),
        );
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载节点列表失败');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  const startHostEdit = (group: VpsNodeGroup) => {
    if (hostUpdateInFlightRef.current) return;
    setEditingVpsId(group.id);
    setEditingHost(group.host);
    setHostUpdateState('idle');
    setHostUpdateError('');
  };

  const cancelHostEdit = () => {
    if (hostUpdateInFlightRef.current) return;
    setEditingVpsId(null);
    setEditingHost('');
    setHostUpdateState('idle');
    setHostUpdateError('');
  };

  const saveHostEdit = (group: VpsNodeGroup) => {
    if (hostUpdateInFlightRef.current) return;
    const nextHost = editingHost.trim();
    if (!nextHost) {
      setHostUpdateState('err');
      setHostUpdateError('VPS IP 或域名不能为空');
      return;
    }

    if (nextHost === group.host) {
      cancelHostEdit();
      return;
    }

    hostUpdateInFlightRef.current = true;
    setHostUpdateState('saving');
    setHostUpdateError('');
    const activityLease = acquireDeploymentActivity();

    void updateVpsProfileHost(group.id, nextHost)
      .then(() => {
        setEditingVpsId(null);
        setEditingHost('');
        setHostUpdateState('idle');
        setHostUpdateError('');
        setRefreshTick((value) => value + 1);
      })
      .catch((err) => {
        setHostUpdateState('err');
        setHostUpdateError(extractErrorMessage(err));
      })
      .finally(() => {
        hostUpdateInFlightRef.current = false;
        releaseDeploymentActivity(activityLease);
      });
  };

  const groups = useMemo<VpsNodeGroup[]>(() => {
    const map = new Map<string, VpsNodeGroup>();

    for (const node of nodes) {
      const groupId = node.vpsId || `${node.host}:${node.sshPort}:${node.sshUser}`;
      const current = map.get(groupId);

      if (current) {
        current.nodes.push(node);
        current.latestCreatedAt = Math.max(
          current.latestCreatedAt,
          normalizeTimestamp(node.createdAt),
        );
        continue;
      }

      map.set(groupId, {
        id: groupId,
        vpsName: node.vpsName || node.host,
        host: node.host,
        sshPort: node.sshPort,
        sshUser: node.sshUser,
        latestCreatedAt: normalizeTimestamp(node.createdAt),
        nodes: [node],
      });
    }

    return [...map.values()]
      .map((group) => ({
        ...group,
        nodes: [...group.nodes].sort(
          (a, b) => normalizeTimestamp(b.createdAt) - normalizeTimestamp(a.createdAt),
        ),
      }))
      .sort((a, b) => b.latestCreatedAt - a.latestCreatedAt);
  }, [nodes]);

  return (
    <PageShell width="xl">
      <SectionHeader
        eyebrow="总览"
        title="VPS 节点列表"
        description="同一台 VPS 会收拢到同一张卡片里，便于复用登录资料并管理多个协议实例。"
        actions={
          <>
            {/* UpdateControl 由外壳代理改造为次要样式，此处仅提供页头挂载位 */}
            <UpdateControl />
            <Button
              variant="primary"
              onClick={() => navigate('/new')}
              disabled={deploymentActive}
              title={deploymentActive ? '远端任务进行中，请稍候' : undefined}
            >
              新建节点
            </Button>
          </>
        }
      />

      <div className="mt-6">
        {loading ? (
          <div className="space-y-5">
            <GroupSkeleton />
            <GroupSkeleton />
          </div>
        ) : error ? (
          <Callout variant="danger" title="节点列表加载失败">
            <p>{error}</p>
            <div className="mt-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setRefreshTick((value) => value + 1)}
              >
                重试
              </Button>
            </div>
          </Callout>
        ) : groups.length === 0 ? (
          <Card padding="lg" className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-panel bg-gradient-to-b from-brand-50 to-brand-100 text-brand-600 ring-1 ring-inset ring-brand-200/70 dark:from-brand-900/50 dark:to-brand-800/40 dark:text-brand-300 dark:ring-brand-500/20">
              <EmptyServerIcon />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-surface-800 dark:text-surface-100">
              还没有任何节点
            </h2>
            <p className="mt-2 text-sm text-surface-500 dark:text-surface-400">
              先连接一台 VPS，部署第一个协议实例后会自动出现在这里。
            </p>
            <div className="mt-5 flex justify-center">
              <Button variant="primary" onClick={() => navigate('/new')}>
                去创建第一个节点
              </Button>
            </div>
          </Card>
        ) : (
          <div className="space-y-5">
            {groups.map((group) => {
              const protocols = [...new Set(group.nodes.map((item) => item.protocol))];
              const isEditing = editingVpsId === group.id;

              return (
                <Card key={group.id} padding="lg">
                  <div className="flex flex-col gap-4 border-b border-surface-border pb-5 dark:border-surface-700 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="break-words text-lg font-semibold text-surface-800 dark:text-surface-100">
                          {group.vpsName}
                        </h2>
                        <Badge variant="neutral">{group.nodes.length} 个节点</Badge>
                      </div>
                      <p className="mt-2 break-all text-sm text-surface-500 dark:text-surface-400">
                        {group.host}:{group.sshPort} · {group.sshUser}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-control bg-surface-100 px-4 py-3 dark:bg-surface-900">
                          <p className="text-xs text-surface-500 dark:text-surface-400">最近变更</p>
                          <p className="mt-1 text-sm font-medium text-surface-700 dark:text-surface-200">
                            {formatRelativeTime(group.latestCreatedAt)}
                          </p>
                        </div>
                        <div className="rounded-control bg-surface-100 px-4 py-3 dark:bg-surface-900">
                          <p className="text-xs text-surface-500 dark:text-surface-400">协议类型</p>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {protocols.map((protocol) => (
                              <Badge key={protocol} variant="info">
                                {protocolLabel(protocol)}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            navigate(`/control?vpsId=${encodeURIComponent(vpsId(group))}`)
                          }
                          disabled={deploymentActive}
                          title={deploymentActive ? '远端任务进行中，请稍候' : undefined}
                        >
                          控制面板
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => startHostEdit(group)}
                          disabled={deploymentActive}
                        >
                          修改 IP
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* 修改 IP 内联面板：grid-rows 过渡实现平滑展开，Enter 保存 / Esc 取消 */}
                  <div
                    className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
                      isEditing ? 'mt-5 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                    }`}
                  >
                    <div className="min-h-0 overflow-hidden">
                      {isEditing ? (
                        <div className="rounded-card border border-surface-border bg-surface-50 p-4 dark:border-surface-700 dark:bg-surface-900">
                          <Field
                            label="新的服务器 IP / 域名"
                            error={
                              hostUpdateState === 'err' && hostUpdateError
                                ? hostUpdateError
                                : undefined
                            }
                          >
                            <input
                              className={inputClass}
                              value={editingHost}
                              onChange={(event) => setEditingHost(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  saveHostEdit(group);
                                } else if (event.key === 'Escape') {
                                  event.preventDefault();
                                  cancelHostEdit();
                                }
                              }}
                              placeholder={group.host}
                              disabled={hostUpdateState === 'saving'}
                              autoFocus
                            />
                          </Field>
                          <div className="mt-4 flex flex-wrap justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={cancelHostEdit}
                              disabled={hostUpdateState === 'saving'}
                            >
                              取消
                            </Button>
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => saveHostEdit(group)}
                              loading={hostUpdateState === 'saving'}
                              loadingText="保存中…"
                            >
                              保存 IP
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3">
                    {group.nodes.map((node) => {
                      const port = extractPort(node);

                      return (
                        <article
                          key={node.id}
                          className="group rounded-card border border-surface-border bg-surface-50 p-4 transition-[border-color,box-shadow] duration-150 hover:border-brand-300 hover:shadow-card dark:border-surface-700 dark:bg-surface-900 dark:hover:border-brand-700"
                        >
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="break-words text-base font-semibold text-surface-800 dark:text-surface-100">
                                  {node.name}
                                </h3>
                                <Badge variant="info">{protocolLabel(node.protocol)}</Badge>
                                <Badge variant={statusBadgeVariant(node.status)} dot>
                                  {statusLabel(node.status)}
                                </Badge>
                              </div>
                              <p className="mt-2 text-sm text-surface-500 dark:text-surface-400">
                                {port !== undefined ? `服务端口 ${port}` : '端口未记录'} · 创建于{' '}
                                {formatRelativeTime(node.createdAt)}
                              </p>
                              <p className="mt-1.5 font-mono text-xs text-surface-500 dark:text-surface-400">
                                <span className="select-none">节点 ID：</span>
                                <span className="select-text break-all">{node.id}</span>
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => navigate(`/nodes/${node.id}`)}
                              disabled={deploymentActive}
                              title={deploymentActive ? '远端任务进行中，请稍候' : undefined}
                              className="inline-flex shrink-0 items-center gap-1 self-start rounded-control px-2 py-1.5 text-sm font-medium text-brand-600 transition-colors duration-150 hover:bg-brand-50 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent dark:text-brand-300 dark:hover:bg-brand-900/40 dark:hover:text-brand-200 lg:self-center"
                            >
                              查看详情
                              <span className="transition-transform duration-150 motion-safe:group-hover:translate-x-0.5">
                                <ChevronRightIcon />
                              </span>
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </PageShell>
  );
}
