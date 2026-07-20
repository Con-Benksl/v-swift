import { useEffect, useState } from 'react';
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';
import { extractErrorMessage, formatBytes } from '../lib';
import { Button } from './ui';

type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'latest' | 'error';

export default function UpdateControl() {
  const [state, setState] = useState<UpdateState>('idle');
  const [update, setUpdate] = useState<Update | null>(null);
  const [message, setMessage] = useState('');
  const [downloaded, setDownloaded] = useState(0);
  const [total, setTotal] = useState<number | null>(null);

  const checkForUpdate = async (manual = false) => {
    setState('checking');
    setMessage(manual ? '正在检查更新…' : '');
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
      setMessage(extractErrorMessage(error, '检查更新失败，请稍后重试'));
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
    setMessage('正在下载更新…');
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
          setMessage('更新已安装，请在远端任务结束后手动重启应用');
        }
      });
    } catch (error) {
      setState('error');
      setMessage(extractErrorMessage(error, '下载或安装更新失败，请稍后重试'));
      return;
    }

    setState('ready');
    setMessage('更新已安装，请在远端任务结束后手动重启应用');
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
          role={state === 'error' ? 'alert' : 'status'}
          className={`rounded-control border px-3 py-1.5 text-xs leading-relaxed ${
            state === 'error'
              ? 'border-danger-200 bg-danger-50 text-danger-700 dark:border-danger-700/40 dark:bg-danger-700/15 dark:text-danger-200'
              : 'border-surface-border bg-surface-card text-surface-600 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-300'
          }`}
        >
          {state === 'downloading' && progressLabel ? `${message} ${progressLabel}` : message}
        </span>
      ) : null}

      {state === 'available' ? (
        <Button variant="secondary" size="sm" onClick={() => void installUpdate()}>
          下载并安装
        </Button>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void checkForUpdate(true)}
          loading={state === 'checking'}
          loadingText="检查中…"
          disabled={state === 'downloading'}
        >
          检查更新
        </Button>
      )}
    </div>
  );
}
