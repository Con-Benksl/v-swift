import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
      ? t('subscriptionView.statusRunning', { name: node.name })
      : node.status === 'unknown'
        ? t('subscriptionView.statusPending', { name: node.name })
        : t('subscriptionView.statusUninstalled', { name: node.name });
  const statusDescription =
    node.status === 'active'
      ? t('subscriptionView.descActive')
      : node.status === 'unknown'
        ? t('subscriptionView.descUnknown')
        : t('subscriptionView.descUninstalled');
  const importDisabled = node.status === 'uninstalled';

  /** 交给系统打开客户端深链；失败时明确告知，而不是静默无反应。 */
  const importToClient = async (label: string, url: string) => {
    try {
      await openExternal(url);
    } catch {
      toast.error(t('subscriptionView.importFailedToast', { label }), {
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
      toast.error(t('subscriptionView.copyFailedToast'));
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
        <StatCard label={t('subscriptionView.statVpsName')} value={node.vpsName} />
        <StatCard label={t('subscriptionView.statNodeName')} value={node.name} />
        <StatCard label={t('subscriptionView.statHost')} value={node.host} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* 单节点订阅 */}
        <Card padding="lg">
          <p className="text-sm font-semibold text-surface-800 dark:text-surface-100">
            {t('subscriptionView.singleNodeTitle')}
          </p>
          <p className="mt-1 text-xs text-surface-500 dark:text-surface-400">
            {t('subscriptionView.singleNodeHint')}
          </p>
          {isSafeQrSvg(qrSvg) ? (
            <div
              className="mx-auto mt-4 flex h-48 w-48 items-center justify-center rounded-card border border-surface-border bg-white p-3"
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
          ) : (
            <div className="mx-auto mt-4 flex h-48 w-48 items-center justify-center rounded-card border border-dashed border-surface-border p-3 text-center text-xs text-surface-500 dark:border-surface-700 dark:text-surface-400">
              {t('subscriptionView.qrUnavailable')}
            </div>
          )}
          <div className="mt-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-surface-500 dark:text-surface-400">
                {t('subscriptionView.uriLabel')}
              </p>
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={showUri}
                aria-controls={uriDisclosureId}
                onClick={() => setShowUri((open) => !open)}
              >
                {showUri ? t('subscriptionView.collapseButton') : t('subscriptionView.expandButton')}
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
                onClick={() => copyUri('uri', uri, t('subscriptionView.copiedUriMessage'))}
                className="gap-1.5"
              >
                {copiedKey === 'uri' ? (
                  <>
                    <CopyCheckIcon />
                    {t('subscriptionView.copiedButton')}
                  </>
                ) : (
                  t('subscriptionView.copyUriButton')
                )}
              </Button>
              <span className="text-xs text-surface-500 dark:text-surface-400">
                {t('subscriptionView.uriTip')}
              </span>
            </div>
          </div>
        </Card>

        <div className="space-y-6">
          {/* 一键导入客户端 */}
          <Card padding="lg">
            <p className="text-sm font-semibold text-surface-800 dark:text-surface-100">
              {t('subscriptionView.importTitle')}
            </p>
            <p className="mt-1 text-xs text-surface-500 dark:text-surface-400">
              {t('subscriptionView.importHint')}
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
                    {t('subscriptionView.importClientButton', { label: item.label })}
                  </Button>
                ))}
            </div>
          </Card>

          {/* 远程多节点订阅 */}
          {managedUri ? (
            <Card padding="lg" className="border-brand-200 bg-brand-50/60 dark:border-brand-500/30 dark:bg-brand-500/5">
              <p className="text-sm font-semibold text-surface-800 dark:text-surface-100">
                {t('subscriptionView.managedTitle')}
              </p>
              <p className="mt-1 text-xs text-surface-500 dark:text-surface-400">
                {t('subscriptionView.managedHint')}
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
                    {t('subscriptionView.managedUriLabel')}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-expanded={showManagedUri}
                    aria-controls={managedUriDisclosureId}
                    onClick={() => setShowManagedUri((open) => !open)}
                  >
                    {showManagedUri
                      ? t('subscriptionView.collapseButton')
                      : t('subscriptionView.expandButton')}
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
                    onClick={() =>
                      copyUri('managed', managedUri, t('subscriptionView.copiedManagedMessage'))
                    }
                    className="gap-1.5"
                  >
                    {copiedKey === 'managed' ? (
                      <>
                        <CopyCheckIcon />
                        {t('subscriptionView.copiedButton')}
                      </>
                    ) : (
                      t('subscriptionView.copyManagedButton')
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
                    {t('subscriptionView.importClashButton')}
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
