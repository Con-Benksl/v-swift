import { useEffect, useRef, useState } from 'react';
import { Button, Card, SegmentedControl, Spinner } from '../ui';

interface LogViewerProps {
  logs: string[];
  loading?: boolean;
  onRefresh: () => void;
  /** 可切换的协议选项（来自服务列表），为空时隐藏切换器 */
  protocolOptions: { value: string; label: string }[];
  /** 当前展示的协议（受控） */
  activeProtocol: string;
  onProtocolChange: (protocol: string) => void;
}

/** 日志级别着色：ERROR/FATAL → danger，WARN → warning，其余默认（在深色面板上取 300 档保证可读） */
function lineTextClass(line: string): string {
  if (/\b(ERROR|FATAL|CRITICAL)\b/.test(line)) return 'text-danger-300';
  if (/\bWARN(?:ING)?\b/.test(line)) return 'text-warning-300';
  return 'text-surface-300';
}

/** 距底部小于该阈值时视为「在底部」，新日志到达时自动跟随 */
const FOLLOW_THRESHOLD_PX = 32;

function CopyIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.25 7.5V6a2.25 2.25 0 0 1 2.25-2.25h6A2.25 2.25 0 0 1 18.75 6v8.25a2.25 2.25 0 0 1-2.25 2.25H15M5.25 9.75h6a2.25 2.25 0 0 1 2.25 2.25v6a2.25 2.25 0 0 1-2.25 2.25h-6A2.25 2.25 0 0 1 3 18v-6a2.25 2.25 0 0 1 2.25-2.25Z"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

export function LogViewer({
  logs,
  loading,
  onRefresh,
  protocolOptions,
  activeProtocol,
  onProtocolChange,
}: LogViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  /** 是否跟随滚动到底部；用户上滚查看历史时暂停跟随 */
  const followRef = useRef(true);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  /* 切换协议后恢复跟随并回到底部 */
  useEffect(() => {
    followRef.current = true;
  }, [activeProtocol]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && followRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    followRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_THRESHOLD_PX;
  };

  const handleCopyAll = async () => {
    if (logs.length === 0) return;
    try {
      await navigator.clipboard.writeText(logs.join('\n'));
    } catch {
      /* 剪贴板不可用时不打扰用户，仅不进入已复制态 */
      return;
    }
    setCopied(true);
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Card
      padding="none"
      className="flex h-96 min-h-[16rem] resize-y flex-col overflow-hidden"
    >
      {/* 工具栏：协议切换 + 复制 + 刷新 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-border px-3 py-2 dark:border-surface-700">
        {protocolOptions.length > 0 ? (
          <SegmentedControl
            size="sm"
            options={protocolOptions}
            value={activeProtocol}
            onChange={onProtocolChange}
            aria-label="日志协议"
          />
        ) : (
          <span className="text-xs text-surface-500 dark:text-surface-400">暂无日志来源</span>
        )}
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleCopyAll()}
            disabled={logs.length === 0}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? '已复制' : '复制全部'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            loading={loading}
            loadingText="刷新中…"
          >
            刷新
          </Button>
        </div>
      </div>

      {/* 日志区：深色面板（token 化），mono 字体，自动滚底、上滚暂停跟随 */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto bg-surface-900 px-4 py-3 font-mono text-xs leading-relaxed dark:bg-surface-950"
      >
        {loading && logs.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-surface-500 dark:text-surface-400">
            <Spinner size="md" tone="inherit" label="加载日志" />
            <span className="ml-2.5">正在加载日志…</span>
          </div>
        ) : logs.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-surface-500">
            暂无日志
          </div>
        ) : (
          logs.map((line, i) => (
            <div key={i} className="border-b border-surface-800/60 py-1 last:border-0">
              <span className="mr-3 select-none text-surface-500">
                [{String(i + 1).padStart(3, '0')}]
              </span>
              <span className={lineTextClass(line)}>{line}</span>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
