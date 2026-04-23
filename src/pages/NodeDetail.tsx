import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import SubscriptionView from '../components/SubscriptionView';
import { getNode, getSubscription, uninstallNode } from '../ipc';
import { NodeRecord } from '../ipc/types';

function normalizeTimestamp(timestamp: number) {
  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
}

function formatAbsoluteTime(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(normalizeTimestamp(timestamp));
}

function protocolLabel(protocol: NodeRecord['protocol']) {
  return protocol === 'vless-reality' ? 'VLESS Reality' : 'Hysteria 2';
}

function statusLabel(status: NodeRecord['status']) {
  if (status === 'active') return '运行中';
  if (status === 'uninstalled') return '已卸载';
  return '未知';
}

function extractPort(node: NodeRecord) {
  const value = node.protocolParams.port;
  return typeof value === 'number' ? value : '未记录';
}

export default function NodeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [node, setNode] = useState<NodeRecord | null>(null);
  const [subscription, setSubscription] = useState<{ uri: string; qrSvg: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);

  useEffect(() => {
    if (!id) {
      setError('缺少节点 ID');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError('');

    Promise.all([getNode(id), getSubscription(id)])
      .then(([record, sub]) => {
        if (cancelled) {
          return;
        }

        setNode(record);
        setSubscription(sub);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载节点详情失败');
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
  }, [id]);

  const handleUninstall = () => {
    if (!id) {
      return;
    }

    setUninstalling(true);
    void uninstallNode(id)
      .then(() => navigate('/'))
      .catch((err) => {
        setError(err instanceof Error ? err.message : '卸载失败');
        setShowConfirm(false);
      })
      .finally(() => {
        setUninstalling(false);
      });
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(37,99,235,0.14),_transparent_35%),linear-gradient(180deg,_#f8fafc_0%,_#e2e8f0_100%)] px-6 py-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <section className="rounded-[2rem] border border-white/60 bg-white/80 p-8 shadow-xl shadow-slate-300/30 backdrop-blur">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-600">节点详情</p>
              <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">
                {node?.name ?? '正在加载'}
              </h1>
              <p className="mt-3 text-sm text-slate-500">
                {node
                  ? `${node.vpsName} · ${node.host}:${node.sshPort} · ${protocolLabel(node.protocol)}`
                  : '读取节点信息中'}
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => navigate('/')}
                className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-blue-300 hover:text-blue-700"
              >
                返回列表
              </button>
              <button
                type="button"
                onClick={() => setShowConfirm(true)}
                disabled={!node || uninstalling}
                className="rounded-2xl bg-rose-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {uninstalling ? '卸载中...' : '卸载节点'}
              </button>
            </div>
          </div>

          {node ? (
            <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-3xl border border-slate-200 bg-slate-50 px-5 py-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">状态</p>
                <p className="mt-2 text-lg font-semibold text-slate-900">{statusLabel(node.status)}</p>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-slate-50 px-5 py-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">VPS 名称</p>
                <p className="mt-2 text-lg font-semibold text-slate-900">{node.vpsName}</p>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-slate-50 px-5 py-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">SSH 登录</p>
                <p className="mt-2 text-lg font-semibold text-slate-900">{node.sshUser}</p>
                <p className="mt-1 text-sm text-slate-500">
                  {node.host}:{node.sshPort}
                </p>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-slate-50 px-5 py-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">协议端口</p>
                <p className="mt-2 text-lg font-semibold text-slate-900">{extractPort(node)}</p>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-slate-50 px-5 py-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">创建时间</p>
                <p className="mt-2 text-lg font-semibold text-slate-900">
                  {formatAbsoluteTime(node.createdAt)}
                </p>
              </div>
            </div>
          ) : null}
        </section>

        {loading ? (
          <div className="rounded-3xl border border-slate-200 bg-white/90 p-10 text-center text-sm text-slate-500 shadow-sm shadow-slate-200/60">
            正在加载节点详情...
          </div>
        ) : error ? (
          <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
            {error}
          </div>
        ) : node && subscription ? (
          <SubscriptionView node={node} uri={subscription.uri} qrSvg={subscription.qrSvg} />
        ) : null}
      </div>

      {showConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-6 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl shadow-slate-950/20">
            <h2 className="text-xl font-semibold text-slate-950">确认卸载节点？</h2>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              这会调用后端卸载流程并移除当前节点记录，但已保存的 VPS 登录资料会继续保留，方便以后复用。
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleUninstall}
                disabled={uninstalling}
                className="rounded-2xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                确认卸载
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
