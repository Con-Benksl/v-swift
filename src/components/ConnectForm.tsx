import { useState } from 'react';
import { forgetOrphanVpsProfiles } from '../ipc';
import { OsInfo, VpsCredential, VpsProfileSummary } from '../ipc/types';

export interface ConnectFormValue {
  mode: 'saved' | 'manual';
  vpsProfileId?: string;
  vpsName: string;
  host: string;
  port: number;
  user: string;
  auth: VpsCredential['auth'];
}

interface ConnectFormProps {
  value: ConnectFormValue;
  profiles: VpsProfileSummary[];
  profilesLoading: boolean;
  profilesError?: string;
  onChange: (value: ConnectFormValue) => void;
  onTestConnection: () => void;
  testState: 'idle' | 'loading' | 'ok' | 'err';
  testError?: string;
  osInfo?: OsInfo | null;
  onProfilesRefresh?: () => void;
}

function updateValue(
  value: ConnectFormValue,
  patch: Partial<ConnectFormValue>,
): ConnectFormValue {
  return { ...value, ...patch };
}

function normalizeTimestamp(timestamp: number) {
  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
}

function formatSavedTime(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(normalizeTimestamp(timestamp));
}

export default function ConnectForm({
  value,
  profiles,
  profilesLoading,
  profilesError,
  onChange,
  onTestConnection,
  testState,
  testError,
  osInfo,
  onProfilesRefresh,
}: ConnectFormProps) {
  const [cleanupState, setCleanupState] = useState<'idle' | 'running' | 'err'>('idle');
  const [cleanupError, setCleanupError] = useState('');

  const handleCleanup = () => {
    setCleanupState('running');
    setCleanupError('');
    void forgetOrphanVpsProfiles()
      .then(() => {
        setCleanupState('idle');
        onProfilesRefresh?.();
      })
      .catch((error) => {
        setCleanupState('err');
        setCleanupError(extractFriendlyError(error));
      });
  };

  function extractFriendlyError(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === 'string' && error) return error;
    if (error && typeof error === 'object') {
      const obj = error as Record<string, unknown>;
      const msg = obj.message;
      if (typeof msg === 'string' && msg) return msg;
      if (msg && typeof msg === 'object') {
        const inner = msg as Record<string, unknown>;
        if (typeof inner.message === 'string' && inner.message) return inner.message;
      }
      if (typeof obj.kind === 'string' && obj.kind) return obj.kind;
    }
    return '操作失败';
  }
  const isPassword = value.auth.kind === 'password';
  const isPrivateKey = value.auth.kind === 'privateKey';
  const availableProfiles = profiles.filter((profile) => profile.credentialAvailable);
  const unavailableProfiles = profiles.filter((profile) => !profile.credentialAvailable);
  const canUseSavedProfiles = availableProfiles.length > 0;
  const effectiveMode = value.mode === 'saved' && canUseSavedProfiles ? 'saved' : 'manual';
  const selectedProfile =
    effectiveMode === 'saved'
      ? availableProfiles.find((profile) => profile.id === value.vpsProfileId) ?? null
      : null;
  const fieldClass =
    'mt-2 w-full rounded-2xl border border-slate-200 bg-slate-950/5 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10';
  const labelClass = 'text-sm font-medium text-slate-700';
  const cardClass = 'rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm shadow-slate-200/60';

  const validationHints = [
    !value.vpsName.trim() ? 'VPS 名称必填' : null,
    effectiveMode === 'saved' && !value.vpsProfileId ? '请选择一个已保存的 VPS' : null,
    effectiveMode === 'manual' && !value.host.trim() ? '服务器 IP 或域名必填' : null,
    effectiveMode === 'manual' && !value.user.trim() ? 'SSH 用户名必填' : null,
    effectiveMode === 'manual' && value.port <= 0 ? 'SSH 端口必须大于 0' : null,
    effectiveMode === 'manual' &&
    isPassword &&
    !(value.auth.kind === 'password' ? value.auth.password : '').trim()
      ? '请输入 SSH 密码'
      : null,
    effectiveMode === 'manual' &&
    isPrivateKey &&
    !(value.auth.kind === 'privateKey' ? value.auth.key : '').trim()
      ? '请输入私钥内容'
      : null,
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <section className={cardClass}>
        <div className="flex flex-col gap-2 border-b border-slate-100 pb-5">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-600">步骤 1</p>
          <h2 className="text-2xl font-semibold text-slate-950">选择 VPS</h2>
          <p className="text-sm text-slate-500">
            可以复用已保存的 VPS 登录资料，也可以录入一台新的服务器。
          </p>
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="space-y-5">
            <label className="block">
              <span className={labelClass}>VPS 名称</span>
              <input
                className={fieldClass}
                value={value.vpsName}
                onChange={(event) => onChange(updateValue(value, { vpsName: event.target.value }))}
                placeholder="例如：洛杉矶主机 / 东京落地机"
              />
              <span className="mt-2 block text-xs text-slate-500">
                这是服务器卡片名称，和后面的节点名称分开管理。
              </span>
            </label>

            <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1">
              <button
                type="button"
                disabled={!canUseSavedProfiles}
                onClick={() =>
                  onChange(updateValue(value, { mode: 'saved', vpsProfileId: value.vpsProfileId }))
                }
                className={`rounded-2xl px-4 py-2 text-sm font-medium transition ${
                  effectiveMode === 'saved'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-950'
                } disabled:cursor-not-allowed disabled:text-slate-400`}
              >
                已保存 VPS
              </button>
              <button
                type="button"
                onClick={() => onChange(updateValue(value, { mode: 'manual', vpsProfileId: undefined }))}
                className={`rounded-2xl px-4 py-2 text-sm font-medium transition ${
                  effectiveMode === 'manual'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-950'
                }`}
              >
                新建连接
              </button>
            </div>

            {profilesLoading ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                正在读取已保存的 VPS...
              </div>
            ) : null}

            {profilesError ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
                已保存 VPS 加载失败：{profilesError}
              </div>
            ) : null}

            {!profilesLoading && profiles.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                还没有已保存的 VPS。完成一次部署后，登录资料会自动保留，后续可直接复用。
              </div>
            ) : null}

            {!profilesLoading && unavailableProfiles.length > 0 ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
                <p className="font-semibold">检测到 {unavailableProfiles.length} 条 VPS 记录缺少系统安全存储凭据</p>
                <p className="mt-2">
                  这些记录会解绑对应的节点（节点本身保留）。可以选择：切换到“新建连接”重新输入 SSH 信息部署时自动修复；或点击下方按钮直接忘记这些失效记录。
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleCleanup}
                    disabled={cleanupState === 'running'}
                    className="rounded-2xl border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {cleanupState === 'running' ? '清理中…' : `忘记这 ${unavailableProfiles.length} 条失效记录`}
                  </button>
                  {cleanupState === 'err' && cleanupError ? (
                    <span className="text-xs text-rose-700">清理失败：{cleanupError}</span>
                  ) : null}
                </div>
              </div>
            ) : null}

            {effectiveMode === 'saved' ? (
              <div className="space-y-4">
                <div className="grid gap-3">
                  {availableProfiles.map((profile) => {
                    const active = profile.id === value.vpsProfileId;

                    return (
                      <button
                        key={profile.id}
                        type="button"
                        onClick={() =>
                          onChange(
                            updateValue(value, {
                              mode: 'saved',
                              vpsProfileId: profile.id,
                              vpsName: value.vpsName.trim() ? value.vpsName : profile.name,
                            }),
                          )
                        }
                        className={`rounded-3xl border p-4 text-left transition ${
                          active
                            ? 'border-blue-500 bg-blue-50 shadow-sm shadow-blue-100/80'
                            : 'border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/60'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-base font-semibold text-slate-950">{profile.name}</h3>
                              <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                                {profile.nodeCount} 个节点
                              </span>
                            </div>
                            <p className="mt-2 text-sm text-slate-500">
                              {profile.host}:{profile.sshPort} · {profile.sshUser}
                            </p>
                          </div>
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-semibold ${
                              active
                                ? 'bg-blue-600 text-white'
                                : 'border border-slate-200 bg-white text-slate-500'
                            }`}
                          >
                            {active ? '当前选择' : '可复用'}
                          </span>
                        </div>
                        <p className="mt-3 text-xs text-slate-400">
                          保存于 {formatSavedTime(profile.createdAt)}
                        </p>
                      </button>
                    );
                  })}
                </div>

                {selectedProfile ? (
                  <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-4">
                    <p className="text-sm font-semibold text-blue-900">将复用已保存的 SSH 凭据</p>
                    <p className="mt-2 text-sm text-blue-700">
                      {selectedProfile.host}:{selectedProfile.sshPort} · {selectedProfile.sshUser}
                    </p>
                    <p className="mt-2 text-xs text-blue-600">
                      测试连接和后续部署都会直接使用这台 VPS 已保存的登录信息。
                    </p>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="space-y-5">
                <div className="grid gap-5 md:grid-cols-2">
                  <label className="block">
                    <span className={labelClass}>服务器 IP / 域名</span>
                    <input
                      className={fieldClass}
                      value={value.host}
                      onChange={(event) => onChange(updateValue(value, { host: event.target.value }))}
                      placeholder="203.0.113.10"
                    />
                  </label>
                  <label className="block">
                    <span className={labelClass}>SSH 端口</span>
                    <input
                      className={fieldClass}
                      type="number"
                      min={1}
                      max={65535}
                      value={value.port}
                      onChange={(event) =>
                        onChange(updateValue(value, { port: Number(event.target.value) || 0 }))
                      }
                    />
                  </label>
                  <label className="block">
                    <span className={labelClass}>SSH 用户名</span>
                    <input
                      className={fieldClass}
                      value={value.user}
                      onChange={(event) => onChange(updateValue(value, { user: event.target.value }))}
                      placeholder="root"
                    />
                  </label>
                </div>

                <div>
                  <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1">
                    <button
                      type="button"
                      className={`rounded-2xl px-4 py-2 text-sm font-medium transition ${
                        isPassword
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'text-slate-600 hover:text-slate-950'
                      }`}
                      onClick={() =>
                        onChange(updateValue(value, { auth: { kind: 'password', password: '' } }))
                      }
                    >
                      密码
                    </button>
                    <button
                      type="button"
                      className={`rounded-2xl px-4 py-2 text-sm font-medium transition ${
                        isPrivateKey
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'text-slate-600 hover:text-slate-950'
                      }`}
                      onClick={() =>
                        onChange(
                          updateValue(value, {
                            auth: { kind: 'privateKey', key: '', passphrase: '' },
                          }),
                        )
                      }
                    >
                      私钥
                    </button>
                  </div>

                  {isPassword ? (
                    <label className="mt-5 block">
                      <span className={labelClass}>SSH 密码</span>
                      <input
                        className={fieldClass}
                        type="password"
                        value={value.auth.kind === 'password' ? value.auth.password : ''}
                        onChange={(event) =>
                          onChange(
                            updateValue(value, {
                              auth: { kind: 'password', password: event.target.value },
                            }),
                          )
                        }
                        placeholder="请输入密码"
                      />
                    </label>
                  ) : null}

                  {isPrivateKey ? (
                    <div className="mt-5 grid gap-5">
                      <label className="block">
                        <span className={labelClass}>私钥内容</span>
                        <textarea
                          className={`${fieldClass} min-h-40 resize-y font-mono text-xs`}
                          value={value.auth.kind === 'privateKey' ? value.auth.key : ''}
                          onChange={(event) =>
                            onChange(
                              updateValue(value, {
                                auth: {
                                  kind: 'privateKey',
                                  key: event.target.value,
                                  passphrase:
                                    value.auth.kind === 'privateKey'
                                      ? value.auth.passphrase
                                      : '',
                                },
                              }),
                            )
                          }
                          placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                        />
                      </label>
                      <label className="block">
                        <span className={labelClass}>私钥口令（可选）</span>
                        <input
                          className={fieldClass}
                          type="password"
                          value={value.auth.kind === 'privateKey' ? (value.auth.passphrase ?? '') : ''}
                          onChange={(event) =>
                            onChange(
                              updateValue(value, {
                                auth: {
                                  kind: 'privateKey',
                                  key: value.auth.kind === 'privateKey' ? value.auth.key : '',
                                  passphrase: event.target.value,
                                },
                              }),
                            )
                          }
                          placeholder="如果私钥有加密口令"
                        />
                      </label>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <p className="text-sm font-semibold text-slate-900">当前连接模式</p>
              <p className="mt-2 text-sm text-slate-600">
                {effectiveMode === 'saved'
                  ? '直接复用已保存的 VPS 登录资料'
                  : '录入新的 SSH 登录信息，首次部署后会自动保存'}
              </p>
              <div className="mt-4 grid gap-3">
                <div className="rounded-2xl bg-white px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-slate-400">VPS 名称</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">
                    {value.vpsName.trim() || '待填写'}
                  </p>
                </div>
                <div className="rounded-2xl bg-white px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-slate-400">连接目标</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">
                    {selectedProfile
                      ? `${selectedProfile.host}:${selectedProfile.sshPort}`
                      : value.host.trim()
                        ? `${value.host}:${value.port}`
                        : '待填写'}
                  </p>
                </div>
                <div className="rounded-2xl bg-white px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-slate-400">认证方式</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">
                    {effectiveMode === 'saved' ? '使用已保存凭据' : isPassword ? '密码' : '私钥'}
                  </p>
                </div>
              </div>
            </div>

            {validationHints.length > 0 ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {validationHints.join('，')}
              </div>
            ) : null}

            {testError ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {testError}
              </div>
            ) : null}

            {osInfo ? (
              <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-4">
                <p className="text-sm font-semibold text-blue-900">已识别系统</p>
                <p className="mt-1 text-sm text-blue-800">
                  {osInfo.distro} {osInfo.version} / {osInfo.arch}
                </p>
              </div>
            ) : null}

            <div className="rounded-3xl border border-slate-200 bg-white p-5">
              <p className="text-sm font-semibold text-slate-900">连接检查</p>
              <p className="mt-2 text-sm text-slate-500">
                先验证 SSH 登录可用，再进入协议部署步骤。
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={onTestConnection}
                  disabled={testState === 'loading' || validationHints.length > 0}
                  className="rounded-2xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {testState === 'loading' ? '连接检测中...' : '测试连接并识别系统'}
                </button>
                <span className="text-sm text-slate-500">
                  {testState === 'ok'
                    ? '连接成功，可以继续下一步。'
                    : effectiveMode === 'saved'
                      ? '保存的 VPS 会直接复用历史凭据。'
                      : '支持密码或私钥认证。'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
