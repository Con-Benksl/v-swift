import { useEffect, useRef, useState } from 'react';
import { updateVpsProfileHost } from '../../ipc';
import { VpsProfileSummary } from '../../ipc/types';
import { extractErrorMessage, normalizeTimestamp } from '../../lib';
import { useDeploymentActivity } from '../../lib/deploymentActivity';
import { Badge, Button, Field, inputClass } from '../ui';

interface SavedProfileListProps {
  /** 凭据可用的已保存 VPS 列表 */
  profiles: VpsProfileSummary[];
  /** 当前选中的档案 id */
  selectedProfileId?: string;
  /** 选中某个档案 */
  onSelect: (profile: VpsProfileSummary) => void;
  /** 修改 IP 保存成功后重新确认选中（用于触发父级测试状态重置） */
  onReselect: (profile: VpsProfileSummary) => void;
  /** 档案列表刷新回调 */
  onProfilesRefresh?: () => void;
}

function formatSavedTime(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(normalizeTimestamp(timestamp));
}

/** 右上角选中对勾（与协议卡统一的选择语言） */
function SelectedCheck() {
  return (
    <span
      aria-hidden="true"
      className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-white dark:bg-brand-500"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3 w-3"
      >
        <path d="m5 12.5 4.5 4.5L19 7.5" />
      </svg>
    </span>
  );
}

/**
 * 已保存 VPS 档案列表：浅底 + brand 描边 + 右上角对勾的选中态；
 * 支持内联「修改 IP」（Enter 保存 / Esc 取消）。
 */
export function SavedProfileList({
  profiles,
  selectedProfileId,
  onSelect,
  onReselect,
  onProfilesRefresh,
}: SavedProfileListProps) {
  const {
    acquire: acquireDeploymentActivity,
    release: releaseDeploymentActivity,
  } = useDeploymentActivity();
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [editingHost, setEditingHost] = useState('');
  const [hostUpdateState, setHostUpdateState] = useState<'idle' | 'saving' | 'err'>('idle');
  const [hostUpdateError, setHostUpdateError] = useState('');
  const hostUpdateInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const selectedProfileIdRef = useRef(selectedProfileId);
  const onReselectRef = useRef(onReselect);
  const onProfilesRefreshRef = useRef(onProfilesRefresh);
  const editButtonRefs = useRef(new Map<string, HTMLButtonElement>());

  selectedProfileIdRef.current = selectedProfileId;
  onReselectRef.current = onReselect;
  onProfilesRefreshRef.current = onProfilesRefresh;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const restoreEditButtonFocus = (profileId: string) => {
    window.requestAnimationFrame(() => editButtonRefs.current.get(profileId)?.focus());
  };

  const startHostEdit = (profile: VpsProfileSummary) => {
    if (hostUpdateInFlightRef.current) {
      return;
    }
    setEditingProfileId(profile.id);
    setEditingHost(profile.host);
    setHostUpdateState('idle');
    setHostUpdateError('');
  };

  const cancelHostEdit = () => {
    if (hostUpdateInFlightRef.current) {
      return;
    }
    const profileId = editingProfileId;
    setEditingProfileId(null);
    setEditingHost('');
    setHostUpdateState('idle');
    setHostUpdateError('');
    if (profileId) {
      restoreEditButtonFocus(profileId);
    }
  };

  const saveHostEdit = (profile: VpsProfileSummary) => {
    if (hostUpdateInFlightRef.current) {
      return;
    }

    const nextHost = editingHost.trim();
    if (!nextHost) {
      setHostUpdateState('err');
      setHostUpdateError('VPS IP 或域名不能为空');
      return;
    }

    if (nextHost === profile.host) {
      cancelHostEdit();
      return;
    }

    hostUpdateInFlightRef.current = true;
    setHostUpdateState('saving');
    setHostUpdateError('');
    const activityLease = acquireDeploymentActivity();

    void updateVpsProfileHost(profile.id, nextHost)
      .then(() => {
        // 父级可能只切到了“新建连接”，此时列表已卸载但仍必须刷新档案缓存。
        onProfilesRefreshRef.current?.();
        if (!mountedRef.current) {
          return;
        }
        setEditingProfileId(null);
        setEditingHost('');
        setHostUpdateState('idle');
        if (selectedProfileIdRef.current === profile.id) {
          onReselectRef.current({ ...profile, host: nextHost });
        }
        restoreEditButtonFocus(profile.id);
      })
      .catch((error) => {
        if (mountedRef.current) {
          setHostUpdateState('err');
          setHostUpdateError(extractErrorMessage(error));
        }
      })
      .finally(() => {
        hostUpdateInFlightRef.current = false;
        releaseDeploymentActivity(activityLease);
      });
  };

  return (
    <div className="grid gap-3">
      {profiles.map((profile) => {
        const active = profile.id === selectedProfileId;
        const editing = editingProfileId === profile.id;

        return (
          <div
            key={profile.id}
            onClick={() => onSelect(profile)}
            className={`relative cursor-pointer rounded-card border p-4 text-left transition ${
              active
                ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-500/10'
                : 'border-surface-border bg-surface-card hover:border-brand-300 dark:border-surface-700 dark:bg-surface-800 dark:hover:border-brand-500'
            }`}
          >
            {active ? <SelectedCheck /> : null}
            <div className="flex items-start justify-between gap-4 pr-6">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="break-words text-sm font-semibold text-surface-800 dark:text-surface-100">
                    {profile.name}
                  </h3>
                  <Badge variant="neutral">{profile.nodeCount} 个节点</Badge>
                </div>
                <p className="mt-1.5 break-all text-sm text-surface-500 dark:text-surface-400">
                  {profile.host}:{profile.sshPort} · {profile.sshUser}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant={active ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-pressed={active}
                  aria-label={active ? `${profile.name} 已选择` : `选择 ${profile.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(profile);
                  }}
                >
                  {active ? '已选择' : '选择'}
                </Button>
                <Button
                  ref={(element) => {
                    if (element) {
                      editButtonRefs.current.set(profile.id, element);
                    } else {
                      editButtonRefs.current.delete(profile.id);
                    }
                  }}
                  variant="ghost"
                  size="sm"
                  aria-label={`修改 ${profile.name} 的 IP`}
                  onClick={(event) => {
                    event.stopPropagation();
                    startHostEdit(profile);
                  }}
                  disabled={hostUpdateState === 'saving'}
                >
                  修改 IP
                </Button>
              </div>
            </div>

            {editing ? (
              <div
                className="mt-3 rounded-control border border-surface-border bg-surface-50 p-3 dark:border-surface-700 dark:bg-surface-900"
                onClick={(event) => event.stopPropagation()}
              >
                <Field
                  label="新的服务器 IP / 域名"
                  error={hostUpdateState === 'err' && hostUpdateError ? hostUpdateError : undefined}
                >
                  <input
                    className={inputClass}
                    value={editingHost}
                    autoFocus
                    disabled={hostUpdateState === 'saving'}
                    onChange={(event) => setEditingHost(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        event.stopPropagation();
                        saveHostEdit(profile);
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        cancelHostEdit();
                      }
                    }}
                    placeholder={profile.host}
                  />
                </Field>
                <div className="mt-3 flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={cancelHostEdit}
                    disabled={hostUpdateState === 'saving'}
                  >
                    取消
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => saveHostEdit(profile)}
                    loading={hostUpdateState === 'saving'}
                    loadingText="保存中…"
                  >
                    保存 IP
                  </Button>
                </div>
              </div>
            ) : null}

            <p className="mt-2 text-xs text-surface-500 dark:text-surface-400">
              保存于 {formatSavedTime(profile.createdAt)}
            </p>
          </div>
        );
      })}
    </div>
  );
}
