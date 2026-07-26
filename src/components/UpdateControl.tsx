import { useEffect, useSyncExternalStore } from 'react';
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';
import { extractErrorMessage, formatBytes } from '../lib';
import { Button } from './ui';

type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'latest' | 'error';

interface UpdateSnapshot {
  state: UpdateState;
  message: string;
  downloaded: number;
  total: number | null;
}

/*
 * 更新状态放在模块级而不是组件 state：本组件挂在节点列表页头，
 * 下载途中用户切走页面会卸载组件。若状态随组件销毁，回到列表页会重新
 * 检查更新并重新显示「下载并安装」，用户可以对同一次更新发起第二次并发安装。
 */
let snapshot: UpdateSnapshot = { state: 'idle', message: '', downloaded: 0, total: null };
let pendingUpdate: Update | null = null;
let installInFlight = false;
let autoCheckStarted = false;
const listeners = new Set<() => void>();

function emit(patch: Partial<UpdateSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): UpdateSnapshot {
  return snapshot;
}

async function checkForUpdate(manual: boolean): Promise<void> {
  if (installInFlight) return;

  emit({ state: 'checking', message: manual ? '正在检查更新…' : '', downloaded: 0, total: null });

  try {
    const nextUpdate = await check();

    if (!nextUpdate) {
      pendingUpdate = null;
      emit({
        state: manual ? 'latest' : 'idle',
        message: manual ? '当前已是最新版本' : '',
      });
      return;
    }

    pendingUpdate = nextUpdate;
    emit({ state: 'available', message: `发现新版本 ${nextUpdate.version}` });
  } catch (error) {
    if (!manual) {
      emit({ state: 'idle', message: '' });
      return;
    }

    emit({
      state: 'error',
      message: extractErrorMessage(error, '检查更新失败，请稍后重试'),
    });
  }
}

async function installUpdate(): Promise<void> {
  if (!pendingUpdate || installInFlight) {
    return;
  }

  const target = pendingUpdate;
  installInFlight = true;
  emit({ state: 'downloading', message: '正在下载更新…', downloaded: 0, total: null });

  try {
    await target.downloadAndInstall((event: DownloadEvent) => {
      if (event.event === 'Started') {
        emit({ downloaded: 0, total: event.data.contentLength ?? null });
      }

      if (event.event === 'Progress') {
        emit({ downloaded: snapshot.downloaded + event.data.chunkLength });
      }
    });
  } catch (error) {
    emit({
      state: 'error',
      message: extractErrorMessage(error, '下载或安装更新失败，请稍后重试'),
    });
    return;
  } finally {
    installInFlight = false;
  }

  pendingUpdate = null;
  emit({ state: 'ready', message: '更新已安装，请在远端任务结束后手动重启应用' });
}

export default function UpdateControl() {
  const { state, message, downloaded, total } = useSyncExternalStore(subscribe, getSnapshot);

  useEffect(() => {
    // 每个应用会话只自动检查一次，避免每次回到列表页都打一次更新端点。
    if (autoCheckStarted) return;
    autoCheckStarted = true;
    void checkForUpdate(false);
  }, []);

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
