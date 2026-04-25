import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import UpdateControl from '../components/UpdateControl';
import { listNodes } from '../ipc';
import { NodeRecord } from '../ipc/types';

interface VpsNodeGroup {
  id: string;
  vpsName: string;
  host: string;
  sshPort: number;
  sshUser: string;
  latestCreatedAt: number;
  nodes: NodeRecord[];
}

function normalizeTimestamp(timestamp: number) {
  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
}

function formatRelativeTime(timestamp: number) {
  const diff = Date.now() - normalizeTimestamp(timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  return `${Math.floor(diff / day)} 天前`;
}

function protocolLabel(protocol: NodeRecord['protocol']) {
  return protocol === 'vless-reality' ? 'VLESS Reality' : 'Hysteria 2';
}

function statusLabel(status: NodeRecord['status']) {
  if (status === 'active') return '运行中';
  if (status === 'uninstalled') return '已卸载';
  return '未知';
}

function statusClass(status: NodeRecord['status']) {
  if (status === 'active') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'uninstalled') return 'border-rose-200 bg-rose-50 text-rose-700';
  return 'border-slate-200 bg-slate-100 text-slate-600';
}

function extractPort(node: NodeRecord) {
  const value = node.protocolParams.port;
  return typeof value === 'number' ? value : undefined;
}

export default function NodeList() {
  const navigate = useNavigate();
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

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
  }, []);

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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(37,99,235,0.14),_transparent_38%),linear-gradient(180deg,_#f8fafc_0%,_#e2e8f0_100%)] px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <section className="rounded-[2rem] border border-white/60 bg-white/75 p-8 shadow-xl shadow-slate-300/30 backdrop-blur">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-600">总览</p>
              <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">VPS 节点列表</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
                同一台 VPS 会收拢到同一张卡片里，便于复用登录资料并管理多个协议实例。
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <UpdateControl />
              <button
                type="button"
                onClick={() => navigate('/new')}
                className="rounded-2xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-500"
              >
                新建节点
              </button>
            </div>
          </div>
        </section>

        <div className="mt-8">
          {loading ? (
            <div className="rounded-3xl border border-slate-200 bg-white/90 p-10 text-center text-sm text-slate-500 shadow-sm shadow-slate-200/60">
              正在加载节点列表...
            </div>
          ) : error ? (
            <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
              {error}
            </div>
          ) : groups.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white/90 p-10 text-center shadow-sm shadow-slate-200/60">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-blue-50 text-2xl text-blue-600">
                +
              </div>
              <h2 className="mt-4 text-2xl font-semibold text-slate-950">还没有任何节点</h2>
              <p className="mt-3 text-sm text-slate-500">
                先连接一台 VPS，部署第一个协议实例后会自动出现在这里。
              </p>
              <button
                type="button"
                onClick={() => navigate('/new')}
                className="mt-6 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-500"
              >
                去创建第一个节点
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              {groups.map((group) => (
                <section
                  key={group.id}
                  className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm shadow-slate-200/60"
                >
                  <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-2xl font-semibold text-slate-950">{group.vpsName}</h2>
                        <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                          {group.nodes.length} 个节点
                        </span>
                      </div>
                      <p className="mt-3 text-sm text-slate-500">
                        {group.host}:{group.sshPort} · {group.sshUser}
                      </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl bg-slate-50 px-4 py-3">
                        <p className="text-xs uppercase tracking-wide text-slate-400">最近变更</p>
                        <p className="mt-1 text-sm font-medium text-slate-800">
                          {formatRelativeTime(group.latestCreatedAt)}
                        </p>
                      </div>
                      <div className="rounded-2xl bg-slate-50 px-4 py-3">
                        <p className="text-xs uppercase tracking-wide text-slate-400">协议类型</p>
                        <p className="mt-1 text-sm font-medium text-slate-800">
                          {[...new Set(group.nodes.map((item) => protocolLabel(item.protocol)))].join(' / ')}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3">
                    {group.nodes.map((node) => {
                      const port = extractPort(node);

                      return (
                        <button
                          key={node.id}
                          type="button"
                          onClick={() => navigate(`/nodes/${node.id}`)}
                          className="rounded-3xl border border-slate-200 bg-slate-50 p-5 text-left transition hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50 hover:shadow-md hover:shadow-blue-100/60"
                        >
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-lg font-semibold text-slate-950">{node.name}</h3>
                                <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                                  {protocolLabel(node.protocol)}
                                </span>
                                <span
                                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClass(node.status)}`}
                                >
                                  {statusLabel(node.status)}
                                </span>
                              </div>
                              <p className="mt-3 text-sm text-slate-500">
                                {port ? `服务端口 ${port}` : '端口待确认'} · 创建于{' '}
                                {formatRelativeTime(node.createdAt)}
                              </p>
                            </div>
                            <div className="rounded-2xl bg-white px-4 py-3">
                              <p className="text-xs uppercase tracking-wide text-slate-400">节点 ID</p>
                              <p className="mt-1 max-w-[18rem] truncate text-sm font-medium text-slate-800">
                                {node.id}
                              </p>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
