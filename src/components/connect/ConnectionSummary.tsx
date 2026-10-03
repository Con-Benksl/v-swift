import { useTranslation } from 'react-i18next';
import { OsInfo } from '../../ipc/types';
import { Button, Callout, Card } from '../ui';

interface ConnectionSummaryProps {
  /** 实际生效的连接模式（无可用档案时 saved 会回落为 manual） */
  effectiveMode: 'saved' | 'manual';
  vpsName: string;
  /** 连接目标展示文本（host:port 或占位文案） */
  targetLabel: string;
  /** 认证方式展示文本 */
  authLabel: string;
  osInfo?: OsInfo | null;
  testState: 'idle' | 'loading' | 'ok' | 'err';
  testError?: string;
  /** 点击测试连接（父级负责无效表单拦截） */
  onTestConnection: () => void;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-control bg-surface-50 px-3 py-2.5 dark:bg-surface-900">
      <p className="text-xs text-surface-500 dark:text-surface-400">{label}</p>
      <p className="mt-0.5 truncate text-sm font-medium text-surface-800 dark:text-surface-100">
        {value}
      </p>
    </div>
  );
}

/**
 * 右栏连接摘要 + 连接检查：当前模式、目标、认证方式一览，
 * 系统识别结果与测试错误反馈，以及「测试连接并识别系统」主按钮。
 */
export function ConnectionSummary({
  effectiveMode,
  vpsName,
  targetLabel,
  authLabel,
  osInfo,
  testState,
  testError,
  onTestConnection,
}: ConnectionSummaryProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <Card padding="md" className="bg-surface-50 dark:bg-surface-900">
        <p className="text-sm font-semibold text-surface-800 dark:text-surface-100">
          {t('connectionSummary.modeTitle')}
        </p>
        <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
          {effectiveMode === 'saved'
            ? t('connectionSummary.modeSavedDesc')
            : t('connectionSummary.modeManualDesc')}
        </p>
        <div className="mt-3 grid gap-2">
          <SummaryRow
            label={t('connectionSummary.rowVpsName')}
            value={vpsName.trim() || t('connectionSummary.pendingLabel')}
          />
          <SummaryRow label={t('connectionSummary.rowTarget')} value={targetLabel} />
          <SummaryRow label={t('connectionSummary.rowAuth')} value={authLabel} />
        </div>
      </Card>

      {testError ? (
        <Callout variant="danger" title={t('connectionSummary.testFailedTitle')}>
          {testError}
        </Callout>
      ) : null}

      {osInfo ? (
        <Callout variant="info" title={t('connectionSummary.osDetectedTitle')}>
          {osInfo.distro} {osInfo.version} / {osInfo.arch}
        </Callout>
      ) : null}

      <Card padding="md">
        <p className="text-sm font-semibold text-surface-800 dark:text-surface-100">
          {t('connectionSummary.checkTitle')}
        </p>
        <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
          {t('connectionSummary.checkHint')}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            onClick={onTestConnection}
            loading={testState === 'loading'}
            loadingText={t('connectionSummary.testingLoading')}
          >
            {t('connectionSummary.testButton')}
          </Button>
          <span className="text-sm text-surface-500 dark:text-surface-400">
            {testState === 'ok'
              ? t('connectionSummary.testOkHint')
              : effectiveMode === 'saved'
                ? t('connectionSummary.savedHint')
                : t('connectionSummary.manualHint')}
          </span>
        </div>
      </Card>
    </div>
  );
}
