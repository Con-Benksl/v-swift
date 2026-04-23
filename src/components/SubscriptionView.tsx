import { useEffect, useState } from 'react';
import { NodeRecord } from '../ipc/types';

interface SubscriptionViewProps {
  node: NodeRecord;
  uri: string;
  qrSvg: string;
}

const importLinks: Array<{
  label: string;
  buildUrl: (uri: string) => string;
}> = [
  {
    label: 'V2RayN',
    buildUrl: (uri) => `v2rayn://install-config?url=${encodeURIComponent(btoa(uri))}`,
  },
  {
    label: 'Shadowrocket',
    buildUrl: (uri) => `shadowrocket://add/${encodeURIComponent(uri)}`,
  },
  {
    label: 'Nekobox',
    buildUrl: (uri) => `nekobox://add-profile?url=${encodeURIComponent(uri)}`,
  },
  {
    label: 'Clash',
    buildUrl: (uri) => `clash://install-config?url=${encodeURIComponent(uri)}`,
  },
];

function formatProtocol(protocol: NodeRecord['protocol']) {
  return protocol === 'vless-reality' ? 'VLESS Reality' : 'Hysteria 2';
}

export default function SubscriptionView({ node, uri, qrSvg }: SubscriptionViewProps) {
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = window.setTimeout(() => setToast(''), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const copyUri = async () => {
    try {
      await navigator.clipboard.writeText(uri);
      setToast('订阅 URI 已复制');
    } catch {
      setToast('复制失败，请手动复制');
    }
  };

  return (
    <section className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm shadow-slate-200/60">
      <div className="flex flex-col gap-2 border-b border-slate-100 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-600">步骤 4</p>
          <h2 className="text-2xl font-semibold text-slate-950">订阅信息</h2>
          <p className="mt-1 text-sm text-slate-500">
            VPS：{node.vpsName} · 节点：{node.name} · {formatProtocol(node.protocol)}
          </p>
        </div>
        {toast ? (
          <div className="rounded-full border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700">
            {toast}
          </div>
        ) : null}
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-3xl border border-slate-200 bg-slate-50 px-5 py-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">VPS 名称</p>
          <p className="mt-2 text-lg font-semibold text-slate-900">{node.vpsName}</p>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-slate-50 px-5 py-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">节点名称</p>
          <p className="mt-2 text-lg font-semibold text-slate-900">{node.name}</p>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-slate-50 px-5 py-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">接入地址</p>
          <p className="mt-2 text-lg font-semibold text-slate-900">{node.host}</p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[280px_1fr]">
        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
          <div
            className="mx-auto flex h-56 w-56 items-center justify-center rounded-3xl bg-white p-4 shadow-inner shadow-slate-200"
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
          <p className="mt-4 text-center text-sm text-slate-500">扫码导入或复制下方 URI。</p>
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-medium text-slate-700">订阅 URI</p>
            <div className="mt-3 break-all rounded-2xl bg-slate-950 p-4 font-mono text-xs leading-6 text-slate-100">
              {uri}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={copyUri}
                className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
              >
                复制 URI
              </button>
              <span className="text-xs text-slate-500">优先使用原始 URI，最不容易导入错参数。</span>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-4">
            <p className="text-sm font-medium text-slate-700">一键导入客户端</p>
            <div className="mt-4 flex flex-wrap gap-3">
              {importLinks.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => window.open(item.buildUrl(uri), '_self')}
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                >
                  导入 {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
