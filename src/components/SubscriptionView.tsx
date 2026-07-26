import { useId, useState } from 'react';
import { openExternal } from '../ipc';
import { NodeRecord } from '../ipc/types';
import { protocolLabel, statusLabel } from '../lib';
import { Badge, Button, Card, StatCard, useToast } from './ui';

interface SubscriptionViewProps {
  node: NodeRecord;
  uri: string;
  qrSvg: string;
  managedUri?: string;
  managedQrSvg?: string;
}

const importLinks: Array<{
  label: string;
  /** 内联品牌图标用的首字母 */
  iconLetter: string;
  /** 是否主推荐（secondary）；其余为次要（ghost/sm） */
  primary?: boolean;
  buildUrl: (uri: string) => string;
}> = [
  {
    label: 'V2RayN',
    iconLetter: 'V',
    primary: true,
    buildUrl: (uri) => `v2rayn://install-config?url=${encodeURIComponent(btoa(uri))}`,
  },
  {
    label: 'Shadowrocket',
    iconLetter: 'S',
    buildUrl: (uri) => `shadowrocket://add/${encodeURIComponent(uri)}`,
  },
  {
    label: 'Nekobox',
    iconLetter: 'N',
    buildUrl: (uri) => `nekobox://add-profile?url=${encodeURIComponent(uri)}`,
  },
  {
    label: 'Clash',
    iconLetter: 'C',
    buildUrl: (uri) => `clash://install-config?url=${encodeURIComponent(uri)}`,
  },
];

/**
 * 二维码 SVG 走 innerHTML，所以在渲染前挡一道。
 *
 * 当前来源是后端本地用 qrcode crate 渲染的纯矩形 SVG，不含脚本；这层校验是纵深防御，
 * 防止未来改成从远端取图时把 XSS 直接引进有完整 IPC 权限的 WebView。
 */
function isSafeQrSvg(svg: string | undefined): svg is string {
  if (!svg) return false;
  const normalized = svg.trim().toLowerCase();
  if (!normalized.startsWith('<svg')) return false;
  return !/<script|<foreignobject|\son\w+\s*=|javascript:/.test(normalized);
}

/** 默认掩码展示：保留协议头，其余以圆点替代，点击可展开 */
function maskUri(value: string): string {
  const schemeEnd = value.indexOf('://');
  const prefix = schemeEnd >= 0 ? value.slice(0, schemeEnd + 3) : '';
  return `${prefix}${'•'.repeat(24)}`;
}

/** 客户端首字母品牌图标（极简 SVG，24px viewBox） */
function ClientIcon({ letter }: { letter: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 shrink-0">
      <rect
        x="2.5"
        y="2.5"
        width="19"
        height="19"
        rx="5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <text
        x="12"
        y="16"
        textAnchor="middle"
        fontSize="10.5"
        fontWeight="600"
        fill="currentColor"
      >
        {letter}
      </text>
    </svg>
  );
}

function CopyCheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-3.5 w-3.5"
    >
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

function NodeStatusIcon({ status }: { status: NodeRecord['status'] }) {
  if (status === 'unknown') {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="h-5 w-5"
      >
        <path d="M10.3 3.5 2.7 17a2 2 0 0 0 1.8 3h15a2 2 0 0 0 1.8-3L13.7 3.5a2 2 0 0 0-3.4 0Z" />
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
      </svg>
    );
  }

  if (status === 'uninstalled') {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="h-5 w-5"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="m9 9 6 6" />
        <path d="m15 9-6 6" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-5 w-5"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 5-6" />
    </svg>
  );
}

/**
 * 步骤 4「订阅信息」：成功确认头 + 节点摘要 + 双二维码（统一尺寸）+
 * 掩码 URI（点击展开）+ 复制（copied 对勾态 + toast）+ 客户端一键导入。
 */
export default function SubscriptionView({
  node,
  uri,
  qrSvg,
  managedUri,
  managedQrSvg,
}: SubscriptionViewProps) {
  const toast = useToast();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showUri, setShowUri] = useState(false);
  const [showManagedUri, setShowManagedUri] = useState(false);
  const uriDisclosureId = useId();
  const managedUriDisclosureId = useId();
  const statusVariant =
    node.status === 'active' ? 'success' : node.status === 'unknown' ? 'warning' : 'danger';
  const statusIconClass =
    node.status === 'active'
      ? 'bg-success-50 text-success-600 dark:bg-success-500/10 dark:text-success-400'
      : node.status === 'unknown'
        ? 'bg-warning-50 text-warning-600 dark:bg-warning-500/10 dark:text-warning-400'
        : 'bg-danger-50 text-danger-600 dark:bg-danger-500/10 dark:text-danger-400';
  const statusTitle =
    node.status === 'active'
      ? `节点「${node.name}」运行中`
      : node.status === 'unknown'
        ? `节点「${node.name}」状态待确认`
        : `节点「${node.name}」已卸载`;
  const statusDescription =
    node.status === 'active'
      ? '订阅信息已生成，可扫码或复制导入客户端；URI 默认掩码展示，点击可展开查看。'
      : node.status === 'unknown'
        ? '订阅信息仍可查看，但当前运行状态尚未确认；导入后请先验证客户端连通性。'
        : '以下内容仅作为历史订阅记录展示；节点已卸载，原有连接不再可用。';
  const importDisabled = node.status === 'uninstalled';

  /** 交给系统打开客户端深链；失败时明确告知，而不是静默无反应。 */
  const importToClient = async (label: string, url: string) => {
    try {
      await openExternal(url);
    } catch {
      toast.error(`无法唤起 ${label}，请确认已安装该客户端，或改用复制 URI 手动导入。`, {
        duration: 5000,
      });
    }
  };

  const copyUri = async (key: string, value: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 2000);
      toast.success(successMessage);
    } catch {
      toast.error('复制失败，请手动复制');
    }
  };

  return (
    <Card padding="lg">
      {/* 节点状态确认头：严格按后端状态表达，不把 unknown/uninstalled 渲染为成功 */}
      <div className="flex items-start gap-3 border-b border-surface-border pb-5 dark:border-surface-700">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${statusIconClass}`}
        >
          <NodeStatusIcon status={node.status} />
        </span>
        <div className="min-w-0">
          <h2 className="break-words text-base font-semibold text-surface-800 dark:text-surface-100">
            {statusTitle}
          </h2>
          <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
            {statusDescription}
          </p>
        </div>
        <div className="ml-auto flex shrink-0 flex-wrap justify-end gap-2">
          <Badge variant={statusVariant} dot>
            {statusLabel(node.status)}
          </Badge>
          <Badge variant="info">{protocolLabel(node.protocol)}</Badge>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <StatCard label="VPS 名称" value={node.vpsName} />
        <StatCard label="节点名称" value={node.name} />
        <StatCard label="接入地址" value={node.host} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* 单节点订阅 */}
        <Card padding="lg">
          <p className="text-sm font-semibold text-surface-800 dark:text-surface-100">
            单节点订阅
          </p>
          <p className="mt-1 text-xs text-surface-500 dark:text-surface-400">
            扫码导入，或复制下方 URI 手动添加。
          </p>
          {isSafeQrSvg(qrSvg) ? (
            <div
              className="mx-auto mt-4 flex h-48 w-48 items-center justify-center rounded-card border border-surface-border bg-white p-3"
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
          ) : (
            <div className="mx-auto mt-4 flex h-48 w-48 items-center justify-center rounded-card border border-dashed border-surface-border p-3 text-center text-xs text-surface-500 dark:border-surface-700 dark:text-surface-400">
              二维码不可用，请改用下方 URI 手动导入。
            </div>
          )}
          <div className="mt-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-surface-500 dark:text-surface-400">
                订阅 URI
              </p>
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={showUri}
                aria-controls={uriDisclosureId}
                onClick={() => setShowUri((open) => !open)}
              >
                {showUri ? '收起' : '展开'}
              </Button>
            </div>
            <div
              id={uriDisclosureId}
              className="mt-2 break-all rounded-control bg-surface-100 p-3 font-mono text-xs leading-6 text-surface-700 dark:bg-surface-900 dark:text-surface-200"
            >
              {showUri ? uri : maskUri(uri)}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                onClick={() => copyUri('uri', uri, '订阅 URI 已复制')}
                className="gap-1.5"
              >
                {copiedKey === 'uri' ? (
                  <>
                    <CopyCheckIcon />
                    已复制
                  </>
                ) : (
                  '复制 URI'
                )}
              </Button>
              <span className="text-xs text-surface-500 dark:text-surface-400">
                优先使用原始 URI，最不容易导入错参数。
              </span>
            </div>
          </div>
        </Card>

        <div className="space-y-6">
          {/* 一键导入客户端 */}
          <Card padding="lg">
            <p className="text-sm font-semibold text-surface-800 dark:text-surface-100">
              一键导入客户端
            </p>
            <p className="mt-1 text-xs text-surface-500 dark:text-surface-400">
              主推荐客户端使用次要按钮样式，其余为轻量入口。
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {importLinks
                .filter((item) => !managedUri || item.label !== 'Clash')
                .map((item) => (
                  <Button
                    key={item.label}
                    variant={item.primary ? 'secondary' : 'ghost'}
                    size={item.primary ? 'md' : 'sm'}
                    onClick={() => void importToClient(item.label, item.buildUrl(uri))}
                    disabled={importDisabled}
                    className="gap-1.5"
                  >
                    <ClientIcon letter={item.iconLetter} />
                    导入 {item.label}
                  </Button>
                ))}
            </div>
          </Card>

          {/* 远程多节点订阅 */}
          {managedUri ? (
            <Card padding="lg" className="border-brand-200 bg-brand-50/60 dark:border-brand-500/30 dark:bg-brand-500/5">
              <p className="text-sm font-semibold text-surface-800 dark:text-surface-100">
                远程多节点订阅
              </p>
              <p className="mt-1 text-xs text-surface-500 dark:text-surface-400">
                适合 Clash/Mihomo 订阅导入，客户端可显示服务端返回的用量头。
              </p>
              {isSafeQrSvg(managedQrSvg) ? (
                <div
                  className="mx-auto mt-4 flex h-48 w-48 items-center justify-center rounded-card border border-surface-border bg-white p-3"
                  dangerouslySetInnerHTML={{ __html: managedQrSvg }}
                />
              ) : null}
              <div className="mt-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-surface-500 dark:text-surface-400">
                    远程订阅链接
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-expanded={showManagedUri}
                    aria-controls={managedUriDisclosureId}
                    onClick={() => setShowManagedUri((open) => !open)}
                  >
                    {showManagedUri ? '收起' : '展开'}
                  </Button>
                </div>
                <div
                  id={managedUriDisclosureId}
                  className="mt-2 break-all rounded-control bg-surface-100 p-3 font-mono text-xs leading-6 text-surface-700 dark:bg-surface-900 dark:text-surface-200"
                >
                  {showManagedUri ? managedUri : maskUri(managedUri)}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => copyUri('managed', managedUri, '远程订阅链接已复制')}
                    className="gap-1.5"
                  >
                    {copiedKey === 'managed' ? (
                      <>
                        <CopyCheckIcon />
                        已复制
                      </>
                    ) : (
                      '复制远程订阅'
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void importToClient(
                        'Clash/Mihomo',
                        `clash://install-config?url=${encodeURIComponent(managedUri)}`,
                      )
                    }
                    disabled={importDisabled}
                    className="gap-1.5"
                  >
                    <ClientIcon letter="C" />
                    导入 Clash/Mihomo
                  </Button>
                </div>
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
