import { useEffect, useRef, useState } from 'react';
import { t } from 'i18next';
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
  detect_os: t('deployProgress.stepDetectOs'),
  prepare: t('deployProgress.stepPrepare'),
  install: t('deployProgress.stepInstall'),
  configure: t('deployProgress.stepConfigure'),
  firewall: t('deployProgress.stepFirewall'),
  reachability: t('deployProgress.stepReachability'),
  subscription: t('deployProgress.stepSubscription'),
  done: t('deployProgress.stepDone'),
};

const baseSteps = ['detect_os', 'prepare', 'install', 'configure', 'firewall'] as const;

type DownloadStage = 'connecting' | 'transferring' | 'waiting' | 'extracting' | 'complete';

const downloadStageLabels: Record<DownloadStage, string> = {
  connecting: t('deployProgress.downloadStageConnecting'),
  transferring: t('deployProgress.downloadStageTransferring'),
  waiting: t('deployProgress.downloadStageWaiting'),
  extracting: t('deployProgress.downloadStageExtracting'),
  complete: t('deployProgress.downloadStageComplete'),
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
        detail: t('deployProgress.downloadAttempt', {
          current: attempt[1],
          total: attempt[2],
        }),
        stage: downloadState?.stage ?? 'connecting',
      };
      continue;
    }

    const received = normalized.match(/^下载中\.\.\. 已接收 (.+)$/);
    if (received) {
      downloadState = {
        artifact: downloadState?.artifact ?? 'Xray',
        attempt: downloadState?.attempt,
        detail: t('deployProgress.downloadedBytes', {
          bytes: formatReceivedText(received[1]),
        }),
        stage: 'transferring',
      };
      continue;
    }

    const waiting = normalized.match(/^下载中\.\.\. 等待数据 \((.+)\)$/);
    if (waiting) {
      downloadState = {
        artifact: downloadState?.artifact ?? 'Xray',
        attempt: downloadState?.attempt,
        detail: t('deployProgress.downloadedBytesWaiting', {
          bytes: formatReceivedText(waiting[1]),
        }),
        stage: 'waiting',
      };
      continue;
    }

    if (normalized === '下载中... 建立连接') {
      downloadState = {
        artifact: downloadState?.artifact ?? 'Xray',
        attempt: downloadState?.attempt,
        detail: t('deployProgress.downloadConnecting'),
        stage: 'connecting',
      };
      continue;
    }

    if (normalized === '下载完成，正在解压 Xray...') {
      downloadState = {
        artifact: 'Xray',
        attempt: downloadState?.attempt,
        detail: t('deployProgress.downloadExtracting'),
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
        detail: t('deployProgress.downloadComplete'),
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
  /**
   * 后端最近报告的步骤。必须走 ref：本 effect 只在挂载时执行一次，
   * 读 currentStep prop 会永远拿到首帧的空值，把失败错误地归因到固定步骤。
   */
  const latestStepRef = useRef('');
  const orderedSteps = [...baseSteps, 'reachability', 'subscription', 'done'];

  useEffect(() => {
    if (hasStartedRef.current) {
      return;
    }

    hasStartedRef.current = true;

    const wrappedOnEvent = (event: DeployEvent) => {
      if (event.kind === 'step' || event.kind === 'error') {
        latestStepRef.current = event.step;
      }
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
        // 没有拿到后端错误事件时，用最近一次真实步骤定位失败点；
        // 一步都没开始就失败时归到首步。
        const step = latestStepRef.current || baseSteps[0];
        const message = extractErrorMessage(error, t('deployProgress.deployFailedGeneric'));
        onEvent({ kind: 'error', step, message });
      });
  }, [onComplete, onEvent, params]);

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
              {t('deployProgress.title')}
            </h2>
            <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
              {t('deployProgress.subtitle')}
            </p>
          </div>
          <Badge variant="info">{protocolLabel(params.protocol)}</Badge>
        </div>

        {/* 全局进度条：已完成 / 总步数 */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-surface-500 dark:text-surface-400">
            <span>{t('deployProgress.overallProgress')}</span>
            <span>
              {t('deployProgress.stepsCompleted', {
                completed: completedCount,
                total: orderedSteps.length,
              })}
            </span>
          </div>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-100 dark:bg-surface-700"
            role="progressbar"
            aria-valuenow={progressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('deployProgress.progressAriaLabel', { percent: progressPercent })}
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-600 transition-[width] duration-500 ease-out dark:from-brand-400 dark:to-brand-500"
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
                      <Spinner
                        size="sm"
                        tone="inherit"
                        label={t('deployProgress.stepSpinnerLabel', { step: stepLabels[step] })}
                      />
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
                        ? t('deployProgress.stepStatusFailed')
                        : isCompleted
                          ? t('deployProgress.stepStatusCompleted')
                          : isCurrent
                            ? t('deployProgress.stepStatusInProgress')
                            : t('deployProgress.stepStatusPending')}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>

        <div className="space-y-4">
          <Card padding="md">
            <p className="text-xs text-surface-500 dark:text-surface-400">
              {t('deployProgress.currentStepLabel')}
            </p>
            <p className="mt-1 text-base font-semibold text-surface-800 dark:text-surface-100">
              {currentStep
                ? (stepLabels[currentStep] ??
                  t('deployProgress.stepInProgressFallback', { step: currentStep }))
                : t('deployProgress.waitingToStart')}
            </p>
            {errorMsg ? (
              <Callout variant="danger" title={t('deployProgress.deployFailedTitle')} className="mt-4">
                <p>{errorMsg}</p>
                <div className="mt-3">
                  <Button variant="danger" size="sm" onClick={onRetry}>
                    {t('deployProgress.retryButton')}
                  </Button>
                </div>
              </Callout>
            ) : (
              <p className="mt-3 rounded-control bg-surface-50 px-3 py-2.5 text-sm text-surface-500 dark:bg-surface-900 dark:text-surface-400">
                {params.credential
                  ? t('deployProgress.connectingWithCredential', {
                      host: params.credential.host,
                      port: params.credential.port,
                      vpsName: params.vpsName,
                      nodeName: params.nodeName,
                    })
                  : t('deployProgress.connectingWithSavedProfile', {
                      vpsName: params.vpsName,
                      nodeName: params.nodeName,
                    })}
              </p>
            )}
          </Card>

          {downloadState ? (
            <Card padding="md" className="border-brand-200 bg-brand-50 dark:border-brand-500/30 dark:bg-brand-500/10">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-surface-800 dark:text-surface-100">
                    {t('deployProgress.downloadingArtifact', {
                      artifact: downloadState.artifact,
                    })}
                  </p>
                  <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
                    {downloadState.detail}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {downloadState.attempt ? (
                    <Badge variant="neutral">
                      {t('deployProgress.attemptNumber', { attempt: downloadState.attempt })}
                    </Badge>
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
                {t('deployProgress.downloadNote')}
              </p>
            </Card>
          ) : null}

          {warnings.length > 0 ? (
            <Callout variant="warning" title={t('deployProgress.warningsTitle')}>
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
                  {t('deployProgress.deployLogTitle')}
                </p>
                <p className="text-xs text-surface-500 dark:text-surface-400">
                  {detailsOpen
                    ? t('deployProgress.logCollapseHint')
                    : t('deployProgress.logExpandHint')}
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
                        ? t('deployProgress.logFoldedWaiting')
                        : t('deployProgress.logNoOutput')}
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
