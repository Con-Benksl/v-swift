import { useEffect, useState } from 'react';
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'latest' | 'error';

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export default function UpdateControl() {
  const [state, setState] = useState<UpdateState>('idle');
  const [update, setUpdate] = useState<Update | null>(null);
  const [message, setMessage] = useState('');
  const [downloaded, setDownloaded] = useState(0);
  const [total, setTotal] = useState<number | null>(null);

  const checkForUpdate = async (manual = false) => {
    setState('checking');
    setMessage(manual ? '正在检查更新...' : '');
    setDownloaded(0);
    setTotal(null);

    try {
      const nextUpdate = await check();

      if (!nextUpdate) {
        setUpdate(null);
        setState(manual ? 'latest' : 'idle');
        setMessage(manual ? '当前已是最新版本' : '');
        return;
      }

      setUpdate(nextUpdate);
      setState('available');
      setMessage(`发现新版本 ${nextUpdate.version}`);
    } catch (error) {
      if (!manual) {
        setState('idle');
        setMessage('');
        return;
      }

      setState('error');
      setMessage(error instanceof Error ? error.message : '检查更新失败');
    }
  };

  useEffect(() => {
    void checkForUpdate(false);
  }, []);

  const installUpdate = async () => {
    if (!update) {
      return;
    }

    setState('downloading');
    setMessage('正在下载更新...');
    setDownloaded(0);
    setTotal(null);

    try {
      await update.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === 'Started') {
          setDownloaded(0);
          setTotal(event.data.contentLength ?? null);
        }

        if (event.event === 'Progress') {
          setDownloaded((value) => value + event.data.chunkLength);
        }

        if (event.event === 'Finished') {
          setMessage('更新已安装，正在重启应用...');
        }
      });

      setState('ready');
      await relaunch();
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : '下载或安装更新失败');
    }
  };

  const progressLabel =
    state === 'downloading'
      ? total
        ? `${formatBytes(downloaded)} / ${formatBytes(total)}`
        : formatBytes(downloaded)
      : '';

  return (
    <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
      {message ? (
        <span
          className={`rounded-2xl border px-4 py-2 text-sm ${
            state === 'error'
              ? 'border-rose-200 bg-rose-50 text-rose-700'
              : 'border-blue-200 bg-blue-50 text-blue-700'
          }`}
        >
          {state === 'downloading' && progressLabel ? `${message} ${progressLabel}` : message}
        </span>
      ) : null}

      {state === 'available' ? (
        <button
          type="button"
          onClick={installUpdate}
          className="rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500"
        >
          下载并安装
        </button>
      ) : (
        <button
          type="button"
          onClick={() => checkForUpdate(true)}
          disabled={state === 'checking' || state === 'downloading'}
          className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
        >
          {state === 'checking' ? '检查中...' : '检查更新'}
        </button>
      )}
    </div>
  );
}
