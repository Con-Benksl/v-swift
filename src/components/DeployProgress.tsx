import { useEffect, useRef, useState } from 'react';
import { deployNode } from '../ipc';
import { DeployEvent, DeployParams, NodeRecord } from '../ipc/types';

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
  done: '完成部署',
};

const baseSteps = ['detect_os', 'prepare', 'install', 'configure', 'firewall'] as const;

type DownloadStage = 'connecting' | 'transferring' | 'waiting' | 'extracting' | 'complete';

interface DownloadState {
  artifact: 'Xray' | 'Hysteria2';
  attempt?: string;
  detail: string;
  stage: DownloadStage;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    const msg = obj.message;
    if (typeof msg === 'string' && msg) return msg;
    if (msg && typeof msg === 'object') {
      const inner = msg as Record<string, unknown>;
      if (typeof inner.message === 'string' && inner.message) {
        return typeof inner.step === 'string'
          ? `[${inner.step}] ${inner.message}`
          : inner.message;
      }
    }
    if (typeof obj.kind === 'string' && obj.kind) return obj.kind;
    try {
      const json = JSON.stringify(error);
      if (json && json !== '{}') return json;
    } catch {
      /* ignore */
    }
  }
  return '部署失败（无详细信息）';
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
        detail: `已下载 ${received[1]}`,
        stage: 'transferring',
      };
      continue;
    }

    const waiting = normalized.match(/^下载中\.\.\. 等待数据 \((.+)\)$/);
    if (waiting) {
      downloadState = {
        artifact: downloadState?.artifact ?? 'Xray',
        attempt: downloadState?.attempt,
        detail: `已下载 ${waiting[1]}，等待更多数据`,
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

function downloadBarClass(stage: DownloadStage) {
  switch (stage) {
    case 'connecting':
      return 'w-1/4 bg-sky-400';
    case 'waiting':
      return 'w-1/2 bg-sky-500';
    case 'transferring':
      return 'w-3/4 bg-blue-500';
    case 'extracting':
      return 'w-5/6 bg-indigo-500';
    case 'complete':
      return 'w-full bg-emerald-500';
  }
}

export default function DeployProgress({
  params,
  events,
  currentStep,
  errorMsg,
  onEvent,
  onComplete,
  onRetry,
}: DeployProgressProps) {
  const [detailsOpen, setDetailsOpen] = useState(true);
  const hasStartedRef = useRef(false);
  const receivedBackendErrorRef = useRef(false);
  const orderedSteps =
    params.protocol === 'vless-reality'
      ? [...baseSteps, 'reachability', 'done']
      : [...baseSteps, 'done'];

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
        const message = extractErrorMessage(error);
        onEvent({ kind: 'error', step, message });
      });
  }, [currentStep, onComplete, onEvent, params]);

  const logLines = events
    .filter((event): event is Extract<DeployEvent, { kind: 'log' }> => event.kind === 'log')
    .map((event) => event.line);
  const { downloadState, visibleLogLines } = summarizeLogs(logLines);
  const currentIndex = orderedSteps.indexOf(currentStep);

  return (
    <section className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm shadow-slate-200/60">
      <div className="flex flex-col gap-2 border-b border-slate-100 pb-5">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-600">步骤 3</p>
        <h2 className="text-2xl font-semibold text-slate-950">部署进度</h2>
        <p className="text-sm text-slate-500">正在远程安装并生成订阅信息，过程中不要关闭窗口。</p>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[280px_1fr]">
        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
          <div className="space-y-3">
            {orderedSteps.map((step, index) => {
              const isCurrent = currentStep === step;
              const isCompleted = currentIndex > index;
              const isPending = !isCurrent && !isCompleted;

              return (
                <div key={step} className="flex items-center gap-3 rounded-2xl px-3 py-3">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${
                      isCompleted
                        ? 'bg-blue-600 text-white'
                        : isCurrent
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-white text-slate-400'
                    }`}
                  >
                    {isCompleted ? '✓' : index + 1}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-900">{stepLabels[step]}</p>
                    <p className="text-xs text-slate-500">
                      {isCompleted ? '已完成' : isCurrent ? '进行中' : isPending ? '等待中' : '未开始'}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-slate-200 bg-slate-950 p-5 text-slate-100 shadow-lg shadow-slate-950/10">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm text-slate-400">当前步骤</p>
                <p className="mt-1 text-lg font-semibold">
                  {currentStep ? (stepLabels[currentStep] ?? `执行中：${currentStep}`) : '等待开始'}
                </p>
              </div>
              <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.2em] text-blue-300">
                {params.protocol}
              </div>
            </div>

            {errorMsg ? (
              <div className="mt-5 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                <p className="font-medium">部署失败</p>
                <p className="mt-1">{errorMsg}</p>
                <button
                  type="button"
                  onClick={onRetry}
                  className="mt-4 rounded-2xl bg-rose-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-400"
                >
                  重新部署
                </button>
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-slate-300">
                {params.credential
                  ? `正在连接 ${params.credential.host}:${params.credential.port}，VPS 名称为 ${params.vpsName}，节点名称为 ${params.nodeName}。`
                  : `正在复用已保存的 VPS「${params.vpsName}」进行部署，节点名称为 ${params.nodeName}。`}
              </div>
            )}
          </div>

          {downloadState ? (
            <div className="rounded-3xl border border-blue-200 bg-blue-50 px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-blue-900">
                    正在下载 {downloadState.artifact}
                  </p>
                  <p className="mt-1 text-sm text-blue-700">{downloadState.detail}</p>
                </div>
                {downloadState.attempt ? (
                  <span className="rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-semibold text-blue-700">
                    第 {downloadState.attempt} 次
                  </span>
                ) : null}
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-white">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    downloadBarClass(downloadState.stage)
                  } ${downloadState.stage === 'complete' ? '' : 'animate-pulse'}`}
                />
              </div>
              <p className="mt-3 text-xs text-blue-600">
                下载心跳已折叠显示，不再逐行写入日志。
              </p>
            </div>
          ) : null}

          <div className="rounded-3xl border border-slate-200 bg-white">
            <button
              type="button"
              onClick={() => setDetailsOpen((open) => !open)}
              className="flex w-full items-center justify-between px-5 py-4 text-left"
            >
              <div>
                <p className="text-sm font-semibold text-slate-900">部署日志</p>
                <p className="text-xs text-slate-500">展开查看后台逐行输出</p>
              </div>
              <span className="text-sm text-blue-600">{detailsOpen ? '收起' : '展开'}</span>
            </button>

            {detailsOpen ? (
              <div className="border-t border-slate-100 px-5 py-4">
                <div className="max-h-72 overflow-auto rounded-2xl bg-slate-950 p-4 font-mono text-xs leading-6 text-slate-200">
                  {visibleLogLines.length > 0 ? (
                    visibleLogLines.map((line, index) => <div key={`${index}-${line}`}>{line}</div>)
                  ) : (
                    <div className="text-slate-500">
                      {downloadState ? '下载日志已折叠，等待后续部署输出。' : '暂无日志输出，等待远程任务开始。'}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
