import { useEffect, useRef, useState } from 'react';
import { deployNode } from '../ipc';
import { DeployEvent, DeployParams, NodeRecord } from '../ipc/types';
import { extractErrorMessage, formatBytes, protocolLabel } from '../lib';
import { Badge, Button, Callout, Card, Spinner } from './ui';

interface DeployProgressProps {
  params: DeployParams;
  events: DeployEvent[];
  currentStep: string;
  errorMsg?: string;
  onEvent: (event: DeployEvent) => void;
  onComplete: (node: NodeRecord) => void;
  onRetry: () => void;
}

const stepLabels: Record<string, string> = {
  detect_os: '识别系统',
  prepare: '准备环境',
  install: '安装核心组件',
  configure: '写入配置',
  firewall: '开放防火墙',
  reachability: '验证公网连通性',
  subscription: '配置托管订阅',
  done: '完成部署',
};

const baseSteps = ['detect_os', 'prepare', 'install', 'configure', 'firewall'] as const;

type DownloadStage = 'connecting' | 'transferring' | 'waiting' | 'extracting' | 'complete';

const downloadStageLabels: Record<DownloadStage, string> = {
  connecting: '建立连接',
  transferring: '传输中',
  waiting: '等待数据',
  extracting: '解压安装',
  complete: '下载完成',
};

interface DownloadState {
  artifact: 'Xray' | 'Hysteria2';
  attempt?: string;
  detail: string;
  stage: DownloadStage;
}

/**
 * 将日志中的「已接收 N」文本格式化为真实字节数。
 * 纯数字按字节走 formatBytes；已带单位的文本原样保留。
 */
function formatReceivedText(text: string): string {
  const trimmed = text.trim();
  if (/^\d+$/.test(trimmed)) {
    return formatBytes(Number(trimmed));
  }
  return trimmed;
}

function summarizeLogs(logLines: string[]) {
  const visibleLogLines: string[] = [];
  let downloadState: DownloadState | null = null;

  for (const line of logLines) {
    const normalized = line.trim();
    const downloadStart = normalized.match(/^正在下载 (Xray|Hysteria2) /);
    if (downloadStart) {
      downloadState = {
        artifact: downloadStart[1] as DownloadState['artifact'],
        detail: normalized,
        stage: 'connecting',
      };
      continue;
    }

    const attempt = normalized.match(/^下载尝试 (\d+)\/(\d+)\.\.\.$/);
    if (attempt) {
      downloadState = {
        artifact: downloadState?.artifact ?? 'Xray',
        attempt: `${attempt[1]}/${attempt[2]}`,
        detail: `下载尝试 ${attempt[1]}/${attempt[2]}`,
        stage: downloadState?.stage ?? 'connecting',
      };
      continue;
    }

    const received = normalized.match(/^下载中\.\.\. 已接收 (.+)$/);
    if (received) {
      downloadState = {
        artifact: downloadState?.artifact ?? 'Xray',
        attempt: downloadState?.attempt,
        detail: `已下载 ${formatReceivedText(received[1])}`,
        stage: 'transferring',
      };
      continue;
    }

    const waiting = normalized.match(/^下载中\.\.\. 等待数据 \((.+)\)$/);
    if (waiting) {
      downloadState = {
        artifact: downloadState?.artifact ?? 'Xray',
        attempt: downloadState?.attempt,
        detail: `已下载 ${formatReceivedText(waiting[1])}，等待更多数据`,
        stage: 'waiting',
      };
      continue;
    }

    if (normalized === '下载中... 建立连接') {
      downloadState = {
        artifact: downloadState?.artifact ?? 'Xray',
        attempt: downloadState?.attempt,
        detail: '正在建立下载连接',
        stage: 'connecting',
      };
      continue;
    }

    if (normalized === '下载完成，正在解压 Xray...') {
      downloadState = {
        artifact: 'Xray',
        attempt: downloadState?.attempt,
        detail: '下载完成，正在解压安装包',
        stage: 'extracting',
      };
      continue;
    }

    if (
      normalized === 'Xray 二进制文件已安装到 /usr/local/bin/xray。' ||
      normalized === 'Hysteria2 二进制文件已安装到 /usr/local/bin/hysteria。'
    ) {
      downloadState = {
        artifact: normalized.startsWith('Xray') ? 'Xray' : 'Hysteria2',
        attempt: downloadState?.attempt,
        detail: '下载并安装完成',
        stage: 'complete',
      };
      continue;
    }

    visibleLogLines.push(line);
  }

  return { downloadState, visibleLogLines };
}

function CheckIcon({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

function CrossIcon({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden="true"
      className={className}
    >
      <path d="m6 6 12 12" />
      <path d="M18 6 6 18" />
    </svg>
  );
}

/**
 * 步骤 3「部署进度」：顶部全局进度条 + 竖向时间线步骤列表
 * （连接线 / 当前步 Spinner / 失败红叉）+ 下载心跳卡 + 可折叠部署日志（失败自动展开）。
 */
export default function DeployProgress({
  params,
  events,
  currentStep,
  errorMsg,
  onEvent,
  onComplete,
  onRetry,
}: DeployProgressProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const hasStartedRef = useRef(false);
  const receivedBackendErrorRef = useRef(false);
  const orderedSteps = [...baseSteps, 'reachability', 'subscription', 'done'];

  useEffect(() => {
    if (hasStartedRef.current) {
      return;
    }

    hasStartedRef.current = true;

    const wrappedOnEvent = (event: DeployEvent) => {
      if (event.kind === 'error') {
        receivedBackendErrorRef.current = true;
      }
      onEvent(event);
    };

    void deployNode(params, wrappedOnEvent)
      .then((node) => {
        onComplete(node);
      })
      .catch((error) => {
        console.error('[deploy_node] rejected:', error);
        if (receivedBackendErrorRef.current) {
          return;
        }
        const step = currentStep || 'install';
        const message = extractErrorMessage(error, '部署失败（无详细信息）');
        onEvent({ kind: 'error', step, message });
      });
  }, [currentStep, onComplete, onEvent, params]);

  /* 失败后自动展开日志，便于定位问题 */
  useEffect(() => {
    if (errorMsg) {
      setDetailsOpen(true);
    }
  }, [errorMsg]);

  const logLines = events
    .filter((event): event is Extract<DeployEvent, { kind: 'log' }> => event.kind === 'log')
    .map((event) => event.line);
  const warnings = events.filter(
    (event): event is Extract<DeployEvent, { kind: 'warning' }> => event.kind === 'warning',
  );
  const { downloadState, visibleLogLines } = summarizeLogs(logLines);
  const isDone = currentStep === 'done';
  const currentIndex = orderedSteps.indexOf(currentStep);
  const failedStep = errorMsg ? currentStep : '';
  const completedCount = isDone ? orderedSteps.length : Math.max(currentIndex, 0);
  const progressPercent = Math.round((completedCount / orderedSteps.length) * 100);

  return (
    <Card padding="lg">
      <div className="border-b border-surface-border pb-4 dark:border-surface-700">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-surface-800 dark:text-surface-100">
              部署进度
            </h2>
            <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
              正在远程安装并生成订阅信息，过程中不要关闭窗口。
            </p>
          </div>
          <Badge variant="info">{protocolLabel(params.protocol)}</Badge>
        </div>

        {/* 全局进度条：已完成 / 总步数 */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-surface-500 dark:text-surface-400">
            <span>总进度</span>
            <span>
              已完成 {completedCount} / {orderedSteps.length} 步
            </span>
          </div>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-100 dark:bg-surface-700"
            role="progressbar"
            aria-valuenow={progressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`部署总进度 ${progressPercent}%`}
          >
            <div
              className="h-full rounded-full bg-brand-600 transition-[width] duration-500 dark:bg-brand-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* 竖向时间线 */}
        <Card padding="md" className="bg-surface-50 dark:bg-surface-900">
          <ol>
            {orderedSteps.map((step, index) => {
              const isFailed = step === failedStep;
              const isCompleted = !isFailed && (isDone || currentIndex > index);
              const isCurrent = !isFailed && !isCompleted && currentStep === step;

              return (
                <li key={step} className="relative flex gap-3 pb-5 last:pb-0">
                  {index < orderedSteps.length - 1 ? (
                    <span
                      aria-hidden="true"
                      className={`absolute left-[13px] top-7 h-[calc(100%-1.75rem)] w-px ${
                        isCompleted ? 'bg-brand-400 dark:bg-brand-500' : 'bg-surface-200 dark:bg-surface-700'
                      }`}
                    />
                  ) : null}
                  <span
                    className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                      isFailed
                        ? 'bg-danger-100 text-danger-600 dark:bg-danger-500/15 dark:text-danger-400'
                        : isCompleted
                          ? 'bg-brand-600 text-white dark:bg-brand-500'
                          : isCurrent
                            ? 'border border-brand-500 bg-brand-50 text-brand-600 dark:border-brand-400 dark:bg-brand-500/10 dark:text-brand-300'
                            : 'bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400'
                    }`}
                  >
                    {isFailed ? (
                      <CrossIcon className="h-3.5 w-3.5" />
                    ) : isCompleted ? (
                      <CheckIcon className="h-3.5 w-3.5" />
                    ) : isCurrent ? (
                      <Spinner size="sm" tone="inherit" label={`${stepLabels[step]}进行中`} />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <div className="min-w-0 pt-0.5">
                    <p
                      className={`text-sm font-medium ${
                        isFailed
                          ? 'text-danger-600 dark:text-danger-400'
                          : 'text-surface-800 dark:text-surface-100'
                      }`}
                    >
                      {stepLabels[step]}
                    </p>
                    <p className="text-xs text-surface-500 dark:text-surface-400">
                      {isFailed
                        ? '失败'
                        : isCompleted
                          ? '已完成'
                          : isCurrent
                            ? '进行中'
                            : '等待中'}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>

        <div className="space-y-4">
          <Card padding="md">
            <p className="text-xs text-surface-500 dark:text-surface-400">当前步骤</p>
            <p className="mt-1 text-base font-semibold text-surface-800 dark:text-surface-100">
              {currentStep ? (stepLabels[currentStep] ?? `执行中：${currentStep}`) : '等待开始'}
            </p>
            {errorMsg ? (
              <Callout variant="danger" title="部署失败" className="mt-4">
                <p>{errorMsg}</p>
                <div className="mt-3">
                  <Button variant="danger" size="sm" onClick={onRetry}>
                    重新部署
                  </Button>
                </div>
              </Callout>
            ) : (
              <p className="mt-3 rounded-control bg-surface-50 px-3 py-2.5 text-sm text-surface-500 dark:bg-surface-900 dark:text-surface-400">
                {params.credential
                  ? `正在连接 ${params.credential.host}:${params.credential.port}，VPS 名称为 ${params.vpsName}，节点名称为 ${params.nodeName}。`
                  : `正在复用已保存的 VPS「${params.vpsName}」进行部署，节点名称为 ${params.nodeName}。`}
              </p>
            )}
          </Card>

          {downloadState ? (
            <Card padding="md" className="border-brand-200 bg-brand-50 dark:border-brand-500/30 dark:bg-brand-500/10">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-surface-800 dark:text-surface-100">
                    正在下载 {downloadState.artifact}
                  </p>
                  <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
                    {downloadState.detail}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {downloadState.attempt ? (
                    <Badge variant="neutral">第 {downloadState.attempt} 次</Badge>
                  ) : null}
                  <Badge variant="info">{downloadStageLabels[downloadState.stage]}</Badge>
                </div>
              </div>
              {/* 单色 brand 不定态进度条（完成后静态全宽），不再有阶段档位与换色 */}
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white dark:bg-surface-800">
                <div
                  className={`h-full w-full rounded-full bg-brand-600 dark:bg-brand-500 ${
                    downloadState.stage === 'complete' ? '' : 'animate-pulse'
                  }`}
                />
              </div>
              <p className="mt-2 text-xs text-surface-500 dark:text-surface-400">
                下载心跳已折叠显示，不再逐行写入日志。
              </p>
            </Card>
          ) : null}

          {warnings.length > 0 ? (
            <Callout variant="warning" title="部署警告">
              <ul className="space-y-1.5">
                {warnings.map((warning, index) => (
                  <li key={`${index}-${warning.step}`}>
                    <span className="font-medium">
                      [{stepLabels[warning.step] ?? warning.step}]
                    </span>{' '}
                    {warning.message}
                  </li>
                ))}
              </ul>
            </Callout>
          ) : null}

          <Card padding="none">
            <button
              type="button"
              onClick={() => setDetailsOpen((open) => !open)}
              aria-expanded={detailsOpen}
              className="flex w-full items-center justify-between px-4 py-3.5 text-left"
            >
              <div>
                <p className="text-sm font-semibold text-surface-800 dark:text-surface-100">
                  部署日志
                </p>
                <p className="text-xs text-surface-500 dark:text-surface-400">
                  {detailsOpen ? '点击收起后台逐行输出' : '展开查看后台逐行输出'}
                </p>
              </div>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className={`h-4 w-4 text-surface-500 transition-transform duration-200 dark:text-surface-400 ${
                  detailsOpen ? 'rotate-180' : ''
                }`}
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>

            {detailsOpen ? (
              <div className="border-t border-surface-border px-4 py-3 dark:border-surface-700">
                <div className="max-h-72 overflow-auto rounded-control bg-surface-900 p-3 font-mono text-xs leading-6 text-surface-200 dark:bg-surface-950 dark:text-surface-300">
                  {visibleLogLines.length > 0 ? (
                    visibleLogLines.map((line, index) => <div key={`${index}-${line}`}>{line}</div>)
                  ) : (
                    <div className="text-surface-500">
                      {downloadState
                        ? '下载日志已折叠，等待后续部署输出。'
                        : '暂无日志输出，等待远程任务开始。'}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </Card>
        </div>
      </div>
    </Card>
  );
}
