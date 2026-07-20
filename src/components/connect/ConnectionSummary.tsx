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
  return (
    <div className="space-y-4">
      <Card padding="md" className="bg-surface-50 dark:bg-surface-900">
        <p className="text-sm font-semibold text-surface-800 dark:text-surface-100">当前连接模式</p>
        <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
          {effectiveMode === 'saved'
            ? '直接复用已保存的 VPS 登录资料'
            : '录入新的 SSH 登录信息，首次部署后会自动保存'}
        </p>
        <div className="mt-3 grid gap-2">
          <SummaryRow label="VPS 名称" value={vpsName.trim() || '待填写'} />
          <SummaryRow label="连接目标" value={targetLabel} />
          <SummaryRow label="认证方式" value={authLabel} />
        </div>
      </Card>

      {testError ? (
        <Callout variant="danger" title="连接测试失败">
          {testError}
        </Callout>
      ) : null}

      {osInfo ? (
        <Callout variant="info" title="已识别系统">
          {osInfo.distro} {osInfo.version} / {osInfo.arch}
        </Callout>
      ) : null}

      <Card padding="md">
        <p className="text-sm font-semibold text-surface-800 dark:text-surface-100">连接检查</p>
        <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
          先验证 SSH 登录可用，再进入协议部署步骤。
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            onClick={onTestConnection}
            loading={testState === 'loading'}
            loadingText="连接检测中…"
          >
            测试连接并识别系统
          </Button>
          <span className="text-sm text-surface-500 dark:text-surface-400">
            {testState === 'ok'
              ? '连接成功，可以继续下一步。'
              : effectiveMode === 'saved'
                ? '保存的 VPS 会直接复用历史凭据。'
                : '支持密码或私钥认证。'}
          </span>
        </div>
      </Card>
    </div>
  );
}
