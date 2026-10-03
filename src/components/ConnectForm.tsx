import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();

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
    vpsName: !value.vpsName.trim() ? t('connectForm.errorVpsNameRequired') : undefined,
    vpsProfileId:
      effectiveMode === 'saved' && !value.vpsProfileId
        ? t('connectForm.errorSelectProfile')
        : undefined,
    host:
      effectiveMode === 'manual' && !value.host.trim()
        ? t('connectForm.errorHostRequired')
        : undefined,
    user:
      effectiveMode === 'manual' && !value.user.trim()
        ? t('connectForm.errorUserRequired')
        : undefined,
    port:
      effectiveMode === 'manual' &&
      (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535)
        ? t('connectForm.errorPortRange')
        : undefined,
    password:
      effectiveMode === 'manual' &&
      isPassword &&
      !(value.auth.kind === 'password' ? value.auth.password : '').trim()
        ? t('connectForm.errorPasswordRequired')
        : undefined,
    key:
      effectiveMode === 'manual' &&
      isPrivateKey &&
      !(value.auth.kind === 'privateKey' ? value.auth.key : '').trim()
        ? t('connectForm.errorKeyRequired')
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
        <h2 className="text-base font-semibold text-surface-800 dark:text-surface-100">
          {t('connectForm.title')}
        </h2>
        <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
          {t('connectForm.subtitle')}
        </p>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="space-y-5">
          <Field
            label={t('connectForm.vpsNameLabel')}
            hint={t('connectForm.vpsNameHint')}
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
              placeholder={t('connectForm.vpsNamePlaceholder')}
            />
          </Field>

          <div>
            <p className="mb-1.5 text-sm font-medium text-surface-700 dark:text-surface-300">
              {t('connectForm.connectionMethodLabel')}
            </p>
            <SegmentedControl
              aria-label={t('connectForm.connectionMethodLabel')}
              options={[
                {
                  value: 'saved',
                  label: t('connectForm.modeSaved'),
                  disabled: !canUseSavedProfiles,
                },
                { value: 'manual', label: t('connectForm.modeManual') },
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
            <Callout variant="warning" title={t('connectForm.profilesLoadFailedTitle')}>
              {profilesError}
            </Callout>
          ) : null}

          {!profilesLoading && profiles.length === 0 ? (
            <div className="rounded-card border border-dashed border-surface-300 px-4 py-4 text-sm text-surface-500 dark:border-surface-600 dark:text-surface-400">
              {t('connectForm.noProfilesEmpty')}
            </div>
          ) : null}

          {!profilesLoading && unavailableProfiles.length > 0 ? (
            <Callout
              variant="warning"
              title={t('connectForm.orphanWarningTitle', {
                count: unavailableProfiles.length,
              })}
            >
              <p>
                {t('connectForm.orphanWarningBody', { count: unavailableNodeCount })}
              </p>
              <p className="mt-1 text-xs">{t('connectForm.orphanWarningNote')}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button
                  variant="danger"
                  size="sm"
                  onClick={openCleanupConfirm}
                >
                  {t('connectForm.deleteOrphanButton')}
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
                <Callout variant="info" title={t('connectForm.reuseCredentialsTitle')}>
                  <p>
                    {selectedProfile.host}:{selectedProfile.sshPort} · {selectedProfile.sshUser}
                  </p>
                  <p className="mt-1 text-xs">{t('connectForm.reuseCredentialsNote')}</p>
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
                : t('connectForm.pendingLabel')
          }
          authLabel={
            effectiveMode === 'saved'
              ? t('connectForm.authLabelSaved')
              : isPassword
                ? t('connectForm.authLabelPassword')
                : t('connectForm.authLabelKey')
          }
          osInfo={osInfo}
          testState={testState}
          testError={testError}
          onTestConnection={handleTestClick}
        />
      </div>

      <Modal
        open={cleanupTarget !== null}
        onClose={closeCleanupConfirm}
        title={t('connectForm.cleanupConfirmTitle')}
        description={t('connectForm.cleanupConfirmDescription')}
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
              {t('connectForm.cancelButton')}
            </Button>
            <Button
              variant="danger"
              onClick={handleCleanup}
              loading={cleanupState === 'running'}
              loadingText={t('connectForm.deletingLoading')}
            >
              {t('connectForm.confirmDeleteButton')}
            </Button>
          </>
        }
      >
        <p>
          {t('connectForm.cleanupConfirmBody', {
            profileCount: cleanupTarget?.profileIds.length ?? 0,
            nodeCount: cleanupTarget?.nodeCount ?? 0,
          })}
        </p>
        <p className="mt-2 text-surface-500 dark:text-surface-400">
          {t('connectForm.cleanupConfirmNote')}
        </p>
        {cleanupState === 'err' && cleanupError ? (
          <Callout variant="danger" title={t('connectForm.cleanupFailedTitle')} className="mt-3">
            {cleanupError}
          </Callout>
        ) : null}
      </Modal>
    </Card>
  );
}
