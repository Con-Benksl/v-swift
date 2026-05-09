import { useEffect, useRef } from 'react';

interface LogViewerProps {
  logs: string[];
  loading?: boolean;
  onRefresh: () => void;
}

export function LogViewer({ logs, loading, onRefresh }: LogViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="rounded-3xl border border-slate-200 bg-slate-900 shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="h-3 w-3 rounded-full bg-rose-500" />
            <div className="h-3 w-3 rounded-full bg-amber-500" />
            <div className="h-3 w-3 rounded-full bg-emerald-500" />
          </div>
          <span className="ml-2 text-sm font-medium text-slate-300">日志</span>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-slate-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? '加载中...' : '刷新'}
        </button>
      </div>
      <div
        ref={scrollRef}
        className="h-64 overflow-y-auto p-4 font-mono text-xs leading-relaxed text-slate-300"
      >
        {loading && logs.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-slate-300" />
            <span className="ml-3 text-slate-400">正在加载日志...</span>
          </div>
        ) : logs.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-slate-500">暂无日志</div>
        ) : (
          logs.map((line, i) => (
            <div key={i} className="border-b border-slate-800/50 py-1 last:border-0">
              <span className="mr-3 text-slate-500">[{String(i + 1).padStart(3, '0')}]</span>
              <span>{line}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
