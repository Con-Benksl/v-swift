import { useRef, useState } from 'react';
import { forgetOrphanVpsProfiles } from '../ipc';
import { OsInfo, VpsProfileSummary } from '../ipc/types';
import { extractErrorMessage } from '../lib';
import {
  Button,
  Callout,
  Card,
  Field,
  inputClass,
  Modal,
  SegmentedControl,
  SkeletonText,
} from './ui';
import { ConnectionSummary } from './connect/ConnectionSummary';
import { ManualCredentialFields, ManualFieldErrors } from './connect/ManualCredentialFields';
import { SavedProfileList } from './connect/SavedProfileList';
import type { ConnectFormValue } from './connect/types';

export type { ConnectFormValue } from './connect/types';

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

/**
 * 步骤 1「选择 VPS」：档案复用 / 新建连接双模式表单。
 * 拆分为 SavedProfileList / ManualCredentialFields / ConnectionSummary 三个子组件，
 * 校验为字段级（Field error，touched 或点击测试后显示），不再使用顿号汇总条。
 */
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
  const [cleanupTarget, setCleanupTarget] = useState<{
    profileIds: string[];
    nodeCount: number;
  } | null>(null);
  const cleanupInFlightRef = useRef(false);
  const [touchedFields, setTouchedFields] = useState<ReadonlySet<string>>(new Set());
  const [testAttempted, setTestAttempted] = useState(false);

  const touchField = (field: string) => {
    setTouchedFields((prev) => (prev.has(field) ? prev : new Set(prev).add(field)));
  };

  const handleCleanup = () => {
    if (cleanupInFlightRef.current) {
      return;
    }

    cleanupInFlightRef.current = true;
    setCleanupState('running');
    setCleanupError('');
    const target = cleanupTarget;
    if (!target) {
      cleanupInFlightRef.current = false;
      setCleanupState('idle');
      return;
    }

    void forgetOrphanVpsProfiles(target.profileIds)
      .then(() => {
        setCleanupState('idle');
        setCleanupTarget(null);
        onProfilesRefresh?.();
      })
      .catch((error) => {
        setCleanupState('err');
        setCleanupError(extractErrorMessage(error));
      })
      .finally(() => {
        cleanupInFlightRef.current = false;
      });
  };

  const openCleanupConfirm = () => {
    setCleanupState('idle');
    setCleanupError('');
    setCleanupTarget({
      profileIds: unavailableProfiles.map((profile) => profile.id),
      nodeCount: unavailableNodeCount,
    });
  };

  const closeCleanupConfirm = () => {
    if (cleanupInFlightRef.current) {
      return;
    }
    setCleanupTarget(null);
    setCleanupState('idle');
    setCleanupError('');
  };

  const selectProfile = (profile: VpsProfileSummary) => {
    touchField('vpsProfileId');
    onChange(
      updateValue(value, {
        mode: 'saved',
        vpsProfileId: profile.id,
        vpsName: value.vpsName.trim() ? value.vpsName : profile.name,
      }),
    );
  };

  const isPassword = value.auth.kind === 'password';
  const isPrivateKey = value.auth.kind === 'privateKey';
  const availableProfiles = profiles.filter((profile) => profile.credentialAvailable);
  const unavailableProfiles = profiles.filter((profile) => !profile.credentialAvailable);
  const unavailableNodeCount = unavailableProfiles.reduce(
    (count, profile) => count + profile.nodeCount,
    0,
  );
  const canUseSavedProfiles = availableProfiles.length > 0;
  const effectiveMode = value.mode === 'saved' && canUseSavedProfiles ? 'saved' : 'manual';
  const selectedProfile =
    effectiveMode === 'saved'
      ? availableProfiles.find((profile) => profile.id === value.vpsProfileId) ?? null
      : null;

  /* 字段级校验（全量计算；是否显示由 touched / testAttempted 决定） */
  const errors = {
    vpsName: !value.vpsName.trim() ? 'VPS 名称必填' : undefined,
    vpsProfileId:
      effectiveMode === 'saved' && !value.vpsProfileId ? '请选择一个已保存的 VPS' : undefined,
    host: effectiveMode === 'manual' && !value.host.trim() ? '服务器 IP 或域名必填' : undefined,
    user: effectiveMode === 'manual' && !value.user.trim() ? 'SSH 用户名必填' : undefined,
    port:
      effectiveMode === 'manual' &&
      (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535)
        ? 'SSH 端口必须是 1–65535 之间的整数'
        : undefined,
    password:
      effectiveMode === 'manual' &&
      isPassword &&
      !(value.auth.kind === 'password' ? value.auth.password : '').trim()
        ? '请输入 SSH 密码'
        : undefined,
    key:
      effectiveMode === 'manual' &&
      isPrivateKey &&
      !(value.auth.kind === 'privateKey' ? value.auth.key : '').trim()
        ? '请输入私钥内容'
        : undefined,
  };

  const formValid = !Object.values(errors).some(Boolean);
  const showError = (field: keyof typeof errors) =>
    testAttempted || touchedFields.has(field) ? errors[field] : undefined;

  const manualErrors: ManualFieldErrors = {
    host: showError('host'),
    port: showError('port'),
    user: showError('user'),
    password: showError('password'),
    key: showError('key'),
  };

  const handleTestClick = () => {
    if (!formValid) {
      setTestAttempted(true);
      return;
    }
    onTestConnection();
  };

  return (
    <Card padding="lg">
      <div className="border-b border-surface-border pb-4 dark:border-surface-700">
        <h2 className="text-base font-semibold text-surface-800 dark:text-surface-100">选择 VPS</h2>
        <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
          可以复用已保存的 VPS 登录资料，也可以录入一台新的服务器。
        </p>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="space-y-5">
          <Field
            label="VPS 名称"
            hint="这是服务器卡片名称，和后面的节点名称分开管理。"
            error={showError('vpsName')}
            required
          >
            <input
              className={inputClass}
              value={value.vpsName}
              onChange={(event) => {
                touchField('vpsName');
                onChange(updateValue(value, { vpsName: event.target.value }));
              }}
              placeholder="例如：洛杉矶主机 / 东京落地机"
            />
          </Field>

          <div>
            <p className="mb-1.5 text-sm font-medium text-surface-700 dark:text-surface-300">
              连接方式
            </p>
            <SegmentedControl
              aria-label="连接方式"
              options={[
                { value: 'saved', label: '已保存 VPS', disabled: !canUseSavedProfiles },
                { value: 'manual', label: '新建连接' },
              ]}
              value={effectiveMode}
              onChange={(mode) =>
                onChange(
                  mode === 'saved'
                    ? updateValue(value, { mode: 'saved', vpsProfileId: value.vpsProfileId })
                    : updateValue(value, { mode: 'manual', vpsProfileId: undefined }),
                )
              }
            />
          </div>

          {profilesLoading ? (
            <div className="rounded-card border border-surface-border p-4 dark:border-surface-700">
              <SkeletonText lines={2} />
            </div>
          ) : null}

          {profilesError ? (
            <Callout variant="warning" title="已保存 VPS 加载失败">
              {profilesError}
            </Callout>
          ) : null}

          {!profilesLoading && profiles.length === 0 ? (
            <div className="rounded-card border border-dashed border-surface-300 px-4 py-4 text-sm text-surface-500 dark:border-surface-600 dark:text-surface-400">
              还没有已保存的 VPS。完成一次部署后，登录资料会自动保留，后续可直接复用。
            </div>
          ) : null}

          {!profilesLoading && unavailableProfiles.length > 0 ? (
            <Callout variant="warning" title={`检测到 ${unavailableProfiles.length} 条 VPS 记录缺少系统安全存储凭据`}>
              <p>
                这些记录关联 {unavailableNodeCount} 个本地节点。可以切换到「新建连接」重新输入
                SSH 信息并在部署时修复，或删除失效 VPS 记录及其关联的本地节点记录。
              </p>
              <p className="mt-1 text-xs">
                删除仅清理本机记录，不会卸载远端服务器上已经运行的代理服务。
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button
                  variant="danger"
                  size="sm"
                  onClick={openCleanupConfirm}
                >
                  删除失效记录及关联节点
                </Button>
              </div>
            </Callout>
          ) : null}

          {effectiveMode === 'saved' ? (
            <div className="space-y-4">
              {showError('vpsProfileId') ? (
                <p role="alert" className="text-xs text-danger-600 dark:text-danger-400">
                  {errors.vpsProfileId}
                </p>
              ) : null}
              <SavedProfileList
                profiles={availableProfiles}
                selectedProfileId={value.vpsProfileId}
                onSelect={selectProfile}
                onReselect={(profile) =>
                  onChange(updateValue(value, { mode: 'saved', vpsProfileId: profile.id }))
                }
                onProfilesRefresh={onProfilesRefresh}
              />

              {selectedProfile ? (
                <Callout variant="info" title="将复用已保存的 SSH 凭据">
                  <p>
                    {selectedProfile.host}:{selectedProfile.sshPort} · {selectedProfile.sshUser}
                  </p>
                  <p className="mt-1 text-xs">
                    测试连接和后续部署都会直接使用这台 VPS 已保存的登录信息。
                  </p>
                </Callout>
              ) : null}
            </div>
          ) : (
            <ManualCredentialFields
              value={value}
              errors={manualErrors}
              onChange={(patch) => onChange(updateValue(value, patch))}
              onTouch={touchField}
            />
          )}
        </div>

        <ConnectionSummary
          effectiveMode={effectiveMode}
          vpsName={value.vpsName}
          targetLabel={
            selectedProfile
              ? `${selectedProfile.host}:${selectedProfile.sshPort}`
              : value.host.trim()
                ? `${value.host}:${value.port}`
                : '待填写'
          }
          authLabel={effectiveMode === 'saved' ? '使用已保存凭据' : isPassword ? '密码' : '私钥'}
          osInfo={osInfo}
          testState={testState}
          testError={testError}
          onTestConnection={handleTestClick}
        />
      </div>

      <Modal
        open={cleanupTarget !== null}
        onClose={closeCleanupConfirm}
        title="确认删除失效 VPS 记录？"
        description="该操作会同时删除关联的本地节点记录，且无法撤销。"
        size="sm"
        closeOnOverlayClick={cleanupState !== 'running'}
        closeOnEsc={cleanupState !== 'running'}
        showCloseButton={cleanupState !== 'running'}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={closeCleanupConfirm}
              disabled={cleanupState === 'running'}
            >
              取消
            </Button>
            <Button
              variant="danger"
              onClick={handleCleanup}
              loading={cleanupState === 'running'}
              loadingText="删除中…"
            >
              确认删除
            </Button>
          </>
        }
      >
        <p>
          将重验并删除 {cleanupTarget?.profileIds.length ?? 0} 条失效 VPS 记录，以及它们关联的{' '}
          {cleanupTarget?.nodeCount ?? 0} 个本地节点记录。
        </p>
        <p className="mt-2 text-surface-500 dark:text-surface-400">
          远端 VPS 上的代理服务不会被卸载；如需继续管理，请稍后重新录入 SSH 信息。
        </p>
        {cleanupState === 'err' && cleanupError ? (
          <Callout variant="danger" title="删除失败" className="mt-3">
            {cleanupError}
          </Callout>
        ) : null}
      </Modal>
    </Card>
  );
}
