import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import ConnectForm, { ConnectFormValue } from '../components/ConnectForm';
import DeployProgress from '../components/DeployProgress';
import ProtocolPicker, { ProtocolPickerValue } from '../components/ProtocolPicker';
import SubscriptionView from '../components/SubscriptionView';
import { Button, Callout, Modal, PageShell, SectionHeader, Spinner } from '../components/ui';
import { detectOs, getSubscription, listVpsProfiles, testConnection } from '../ipc';
import {
  extractUnknownSshHostKey,
  mapConnectionError,
  type UnknownSshHostKey,
} from '../ipc/errors';
import { isValidNodeName, isValidSni } from '../lib';
import { useDeploymentActivity } from '../lib/deploymentActivity';
import {
  ConnectionTarget,
  DeployEvent,
  DeployParams,
  NodeRecord,
  OsInfo,
  SubscriptionResult,
  VpsCredential,
  VpsProfileSummary,
} from '../ipc/types';

const steps = [
  { id: 0, title: '选择 VPS' },
  { id: 1, title: '命名节点' },
  { id: 2, title: '部署节点' },
  { id: 3, title: '查看订阅' },
];

const DEFAULT_VLESS_PORT = 443;

function randomPort() {
  return Math.floor(Math.random() * (60000 - 10000 + 1)) + 10000;
}

function baseCredential(): ConnectFormValue {
  return {
    mode: 'manual',
    vpsName: '',
    host: '',
    port: 22,
    user: 'root',
    auth: { kind: 'password', password: '' },
  };
}

function baseProtocol(): ProtocolPickerValue {
  return {
    nodeName: '',
    protocol: 'vless-reality',
    port: DEFAULT_VLESS_PORT,
    sni: 'www.microsoft.com',
  };
}

function buildManualCredential(value: ConnectFormValue): VpsCredential {
  const auth: VpsCredential['auth'] =
    value.auth.kind === 'privateKey'
      ? {
          kind: 'privateKey',
          key: value.auth.key,
          ...(value.auth.passphrase?.trim() ? { passphrase: value.auth.passphrase } : {}),
        }
      : value.auth;

  return {
    host: value.host.trim(),
    port: value.port,
    user: value.user.trim(),
    auth,
  };
}

function buildConnectionTarget(value: ConnectFormValue): ConnectionTarget {
  if (value.mode === 'saved') {
    return { vpsProfileId: value.vpsProfileId };
  }

  return { credential: buildManualCredential(value) };
}

function sameConnectionInput(left: ConnectFormValue, right: ConnectFormValue): boolean {
  if (left.mode !== right.mode || left.vpsName !== right.vpsName) {
    return false;
  }

  if (left.mode === 'saved' || right.mode === 'saved') {
    return left.vpsProfileId === right.vpsProfileId;
  }

  if (
    left.host !== right.host ||
    left.port !== right.port ||
    left.user !== right.user ||
    left.auth.kind !== right.auth.kind
  ) {
    return false;
  }

  if (left.auth.kind === 'password' && right.auth.kind === 'password') {
    return left.auth.password === right.auth.password;
  }

  if (left.auth.kind === 'privateKey' && right.auth.kind === 'privateKey') {
    return left.auth.key === right.auth.key && left.auth.passphrase === right.auth.passphrase;
  }

  return false;
}

/** 细条式步骤指示器：小圆点（序号/对勾）+ 连接线 + 当前步高亮，已完成步可点击回退 */
function WizardStepper({
  step,
  locked,
  onStepBack,
}: {
  step: number;
  locked: boolean;
  onStepBack: (target: number) => void;
}) {
  return (
    <ol className="flex items-center">
      {steps.map((item, index) => {
        const active = item.id === step;
        const completed = item.id < step;
        const canGoBack = completed && !locked && item.id !== 2;

        return (
          <li key={item.id} className="flex min-w-0 flex-1 items-center last:flex-none">
            <button
              type="button"
              disabled={!canGoBack}
              onClick={() => {
                if (canGoBack) {
                  onStepBack(item.id);
                }
              }}
              title={
                locked && completed
                  ? '当前任务完成前暂不能返回'
                  : completed && item.id === 2
                    ? '部署已完成；如需重新部署，请先返回协议设置'
                    : canGoBack
                      ? `返回「${item.title}」`
                      : item.title
              }
              className={`group flex items-center gap-2 rounded-control px-1 py-1 text-left ${
                canGoBack ? 'cursor-pointer' : 'cursor-default'
              }`}
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition ${
                  active
                    ? 'bg-brand-600 text-white dark:bg-brand-500'
                    : completed
                      ? `bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-500 dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-400 ${
                          canGoBack
                            ? 'group-hover:bg-brand-100 dark:group-hover:bg-brand-500/20'
                            : ''
                        }`
                      : 'bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400'
                }`}
              >
                {completed ? (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="h-3.5 w-3.5"
                  >
                    <path d="m5 12.5 4.5 4.5L19 7.5" />
                  </svg>
                ) : (
                  item.id + 1
                )}
              </span>
              <span
                className={`hidden whitespace-nowrap text-sm sm:inline ${
                  active
                    ? 'font-semibold text-brand-600 dark:text-brand-300'
                    : completed
                      ? `font-medium text-surface-700 dark:text-surface-300 ${
                          canGoBack
                            ? 'group-hover:text-brand-600 dark:group-hover:text-brand-300'
                            : ''
                        }`
                      : 'text-surface-500 dark:text-surface-400'
                }`}
              >
                {item.title}
              </span>
            </button>
            {index < steps.length - 1 ? (
              <span
                aria-hidden="true"
                className={`mx-3 h-px min-w-4 flex-1 ${
                  item.id < step ? 'bg-brand-400 dark:bg-brand-500' : 'bg-surface-200 dark:bg-surface-700'
                }`}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/** 步骤切换过渡：挂载时从 opacity-0/translate-y-2 过渡到位 */
function StepTransition({ children }: { children: ReactNode }) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => setEntered(true));
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      className={`transition-all duration-200 ease-out ${
        entered ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
      }`}
    >
      {children}
    </div>
  );
}

/** 每步底部统一操作条：左侧上一步（secondary），右侧下一步/开始部署（primary） */
function WizardActions({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mt-6 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">{left}</div>
      <div className="flex items-center gap-3">{right}</div>
    </div>
  );
}

export default function NewNodeWizard() {
  const navigate = useNavigate();
  const {
    acquire: acquireDeploymentActivity,
    release: releaseDeploymentActivity,
  } = useDeploymentActivity();
  const [step, setStep] = useState(0);
  const [credential, setCredential] = useState<ConnectFormValue>(baseCredential);
  const credentialRef = useRef(credential);
  const connectionTestRequestIdRef = useRef(0);
  const [protocol, setProtocol] = useState<ProtocolPickerValue>(baseProtocol);
  const [profiles, setProfiles] = useState<VpsProfileSummary[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [profilesError, setProfilesError] = useState('');
  const [testState, setTestState] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle');
  const [testError, setTestError] = useState('');
  /**
   * 首次连接遇到未知 SSH 主机密钥时待用户确认的指纹。
   * 必须用应用内 Modal 确认：WebView（wry）未实现 WKUIDelegate 的 JS 对话框回调，
   * 原生 window.confirm 在 macOS 上会被当作“取消”立即返回 false，导致永远无法信任新主机。
   */
  const [pendingHostKey, setPendingHostKey] = useState<UnknownSshHostKey | null>(null);
  const [osInfo, setOsInfo] = useState<OsInfo | null>(null);
  const [events, setEvents] = useState<DeployEvent[]>([]);
  const [currentStep, setCurrentStep] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [deployAttempt, setDeployAttempt] = useState(0);
  const [node, setNode] = useState<NodeRecord | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionResult | null>(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(false);
  const [subscriptionError, setSubscriptionError] = useState('');
  const [deploymentRunning, setDeploymentRunning] = useState(false);

  const [profilesRefreshTick, setProfilesRefreshTick] = useState(0);
  credentialRef.current = credential;

  useEffect(() => {
    return () => {
      connectionTestRequestIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    setProfilesLoading(true);
    setProfilesError('');

    void listVpsProfiles()
      .then((records) => {
        if (cancelled) {
          return;
        }

        setProfiles(records);
        const currentCredential = credentialRef.current;
        let nextCredential = currentCredential;
        const availableProfiles = records.filter((item) => item.credentialAvailable);

        if (availableProfiles.length === 0) {
          if (currentCredential.mode === 'saved') {
            nextCredential = {
              ...currentCredential,
              mode: 'manual',
              vpsProfileId: undefined,
            };
          }
        } else if (currentCredential.mode === 'saved') {
          const selected =
            availableProfiles.find((item) => item.id === currentCredential.vpsProfileId) ??
            availableProfiles[0];
          nextCredential = {
            ...currentCredential,
            vpsProfileId: selected.id,
            vpsName: currentCredential.vpsName.trim()
              ? currentCredential.vpsName
              : selected.name,
          };
        }

        if (!sameConnectionInput(currentCredential, nextCredential)) {
          connectionTestRequestIdRef.current += 1;
          credentialRef.current = nextCredential;
          setCredential(nextCredential);
          setTestState('idle');
          setTestError('');
          setOsInfo(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setProfilesError(error instanceof Error ? error.message : '读取已保存 VPS 失败');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setProfilesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [profilesRefreshTick]);

  const deployParams = useMemo<DeployParams>(
    () => ({
      vpsProfileId: credential.mode === 'saved' ? credential.vpsProfileId : undefined,
      vpsName: credential.vpsName.trim(),
      credential: credential.mode === 'manual' ? buildManualCredential(credential) : undefined,
      protocol: protocol.protocol,
      port: protocol.port,
      nodeName: protocol.nodeName.trim(),
      sni: protocol.protocol === 'vless-reality' ? protocol.sni.trim() : undefined,
    }),
    [credential, protocol],
  );

  const canContinueFromConnect =
    testState === 'ok' &&
    !!osInfo &&
    !!credential.vpsName.trim() &&
    (credential.mode === 'saved'
      ? !!credential.vpsProfileId
      : !!credential.host.trim() &&
        !!credential.user.trim() &&
        Number.isInteger(credential.port) &&
        credential.port >= 1 &&
        credential.port <= 65535);

  const minProtocolPort = 1;
  const protocolValid =
    isValidNodeName(protocol.nodeName) &&
    Number.isInteger(protocol.port) &&
    protocol.port >= minProtocolPort &&
    protocol.port <= 65535 &&
    (protocol.protocol !== 'vless-reality' || isValidSni(protocol.sni));

  const handleCredentialChange = (nextValue: ConnectFormValue) => {
    credentialRef.current = nextValue;
    connectionTestRequestIdRef.current += 1;
    setCredential(nextValue);
    setTestState('idle');
    setTestError('');
    setOsInfo(null);
  };

  const handleProtocolChange = (nextValue: ProtocolPickerValue) => {
    setProtocol((prevValue) => {
      if (
        prevValue.protocol === 'vless-reality' &&
        nextValue.protocol === 'hysteria2' &&
        prevValue.port === DEFAULT_VLESS_PORT &&
        nextValue.port === DEFAULT_VLESS_PORT
      ) {
        return { ...nextValue, port: randomPort() };
      }

      if (prevValue.protocol === 'hysteria2' && nextValue.protocol === 'vless-reality') {
        return { ...nextValue, port: DEFAULT_VLESS_PORT };
      }

      return nextValue;
    });
  };

  /**
   * 跑一次「测试连接 + 识别系统」。
   * `trustedHostKey` 只有在用户已在 Modal 中核对并确认指纹后才会传入。
   */
  const runConnectionTest = (trustedHostKey?: UnknownSshHostKey) => {
    if (
      credential.mode === 'manual' &&
      (!Number.isInteger(credential.port) || credential.port < 1 || credential.port > 65535)
    ) {
      connectionTestRequestIdRef.current += 1;
      setTestState('err');
      setTestError('SSH 端口必须是 1 到 65535 之间的整数。');
      setOsInfo(null);
      return;
    }

    const requestId = connectionTestRequestIdRef.current + 1;
    connectionTestRequestIdRef.current = requestId;
    const credentialSnapshot = credential;
    const baseTarget = buildConnectionTarget(credentialSnapshot);
    const target: ConnectionTarget = trustedHostKey
      ? {
          ...baseTarget,
          acceptNewHostKey: true,
          expectedHostKey: {
            algorithm: trustedHostKey.algorithm,
            fingerprint: trustedHostKey.fingerprint,
          },
        }
      : baseTarget;
    const isCurrentRequest = () =>
      connectionTestRequestIdRef.current === requestId &&
      sameConnectionInput(credentialSnapshot, credentialRef.current);

    setTestState('loading');
    setTestError('');
    setOsInfo(null);

    void testConnection(target)
      .then(() => (isCurrentRequest() ? detectOs(baseTarget) : null))
      .then((info) => {
        if (!info || !isCurrentRequest()) {
          return;
        }
        setOsInfo(info);
        setTestState('ok');
      })
      .catch((error) => {
        if (!isCurrentRequest()) {
          return;
        }

        // 未知主机密钥不是失败，而是需要用户核对指纹后决定是否信任。
        const unknownKey = trustedHostKey ? null : extractUnknownSshHostKey(error);
        if (unknownKey) {
          setTestState('idle');
          setTestError('');
          setPendingHostKey(unknownKey);
          return;
        }

        setTestError(mapConnectionError(error));
        setTestState('err');
      });
  };

  const handleTestConnection = () => runConnectionTest();

  const confirmPendingHostKey = () => {
    const trusted = pendingHostKey;
    if (!trusted) return;
    setPendingHostKey(null);
    runConnectionTest(trusted);
  };

  const rejectPendingHostKey = () => {
    setPendingHostKey(null);
    setTestState('err');
    setTestError('已取消信任新的 SSH 主机密钥，未写入 known_hosts。');
  };

  const handleDeployEvent = (event: DeployEvent) => {
    setEvents((prev) => [...prev, event]);

    if (event.kind === 'step') {
      setCurrentStep(event.step);
      setErrorMsg('');
    }

    if (event.kind === 'error') {
      setCurrentStep(event.step);
      setErrorMsg(event.message);
      setDeploymentRunning(false);
    }
  };

  /** 拉取订阅：成功进入步骤 4，失败停留在部署区并给出重试/跳过并完成 */
  const fetchSubscription = (record: NodeRecord) => {
    setSubscriptionLoading(true);
    setSubscriptionError('');

    void getSubscription(record.id)
      .then((result) => {
        setSubscription(result);
        setStep(3);
      })
      .catch((error) => {
        setSubscriptionError(error instanceof Error ? error.message : '获取订阅信息失败');
      })
      .finally(() => {
        setSubscriptionLoading(false);
      });
  };

  const handleDeployComplete = (record: NodeRecord) => {
    setDeploymentRunning(false);
    setNode(record);
    setCurrentStep('done');
    fetchSubscription(record);
  };

  /** 部署状态重置的唯一入口（开始部署与重新部署共用，避免两份拷贝漂移） */
  const resetDeployState = () => {
    setEvents([]);
    setCurrentStep('');
    setErrorMsg('');
    setNode(null);
    setSubscription(null);
    setSubscriptionError('');
    setSubscriptionLoading(false);
    setDeploymentRunning(false);
    setDeployAttempt((value) => value + 1);
  };

  const restartDeploy = () => {
    resetDeployState();
    setDeploymentRunning(true);
  };

  const startDeploy = () => {
    resetDeployState();
    setDeploymentRunning(true);
    setStep(2);
  };

  const wizardNavigationLocked = deploymentRunning || subscriptionLoading;

  useEffect(() => {
    if (!wizardNavigationLocked) {
      return;
    }

    const lease = acquireDeploymentActivity();
    return () => releaseDeploymentActivity(lease);
  }, [acquireDeploymentActivity, releaseDeploymentActivity, wizardNavigationLocked]);

  /** 已完成的部署步骤不可直接回跳，避免“查看进度”实际触发新的远端部署。 */
  const handleStepBack = (target: number) => {
    if (wizardNavigationLocked || target === 2) {
      return;
    }
    setStep(target);
  };

  return (
    <PageShell width="lg">
      <SectionHeader
        eyebrow="部署向导"
        title="新建节点"
        description="先选择或复用一台 VPS，再单独为本次协议实例命名并自动部署。"
        actions={
          <Button
            variant="secondary"
            onClick={() => navigate('/')}
            disabled={wizardNavigationLocked}
          >
            返回列表
          </Button>
        }
      />

      <div className="mt-6">
        <WizardStepper
          step={step}
          locked={wizardNavigationLocked}
          onStepBack={handleStepBack}
        />
      </div>

      <div className="mt-6">
        {step === 0 ? (
          <StepTransition key={0}>
            <ConnectForm
              value={credential}
              profiles={profiles}
              profilesLoading={profilesLoading}
              profilesError={profilesError}
              onChange={handleCredentialChange}
              onTestConnection={handleTestConnection}
              testState={testState}
              testError={testError}
              osInfo={osInfo}
              onProfilesRefresh={() => setProfilesRefreshTick((value) => value + 1)}
            />
            <WizardActions
              right={
                <>
                  {!canContinueFromConnect ? (
                    <span className="text-xs text-surface-500 dark:text-surface-400">
                      请先测试连接
                    </span>
                  ) : null}
                  <Button onClick={() => setStep(1)} disabled={!canContinueFromConnect}>
                    下一步：命名节点
                  </Button>
                </>
              }
            />
          </StepTransition>
        ) : null}

        {step === 1 ? (
          <StepTransition key={1}>
            <ProtocolPicker value={protocol} onChange={handleProtocolChange} />
            <WizardActions
              left={
                <Button variant="secondary" onClick={() => setStep(0)}>
                  上一步
                </Button>
              }
              right={
                <Button onClick={startDeploy} disabled={!protocolValid}>
                  开始部署
                </Button>
              }
            />
          </StepTransition>
        ) : null}

        {step === 2 ? (
          <StepTransition key={2}>
            <DeployProgress
              key={deployAttempt}
              params={deployParams}
              events={events}
              currentStep={currentStep}
              errorMsg={errorMsg}
              onEvent={handleDeployEvent}
              onComplete={handleDeployComplete}
              onRetry={restartDeploy}
            />

            {/* 订阅获取反馈：留在部署区域内，不再与导航按钮挤一行；失败提供重试/跳过并完成 */}
            {subscriptionLoading ? (
              <Callout variant="info" title="部署完成" className="mt-4">
                <span className="inline-flex items-center gap-2">
                  <Spinner size="sm" />
                  正在获取订阅信息…
                </span>
              </Callout>
            ) : null}
            {subscriptionError ? (
              <Callout variant="danger" title="获取订阅信息失败" className="mt-4">
                <p>{subscriptionError}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      if (node) {
                        fetchSubscription(node);
                      }
                    }}
                    loading={subscriptionLoading}
                    loadingText="重试中…"
                  >
                    重试
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => navigate('/')}>
                    跳过并完成
                  </Button>
                </div>
                <p className="mt-2 text-xs opacity-80">
                  节点已部署成功，跳过后可稍后在节点详情页查看订阅。
                </p>
              </Callout>
            ) : null}

            <WizardActions
              left={
                <Button
                  variant="secondary"
                  onClick={() => handleStepBack(1)}
                  disabled={wizardNavigationLocked}
                >
                  上一步
                </Button>
              }
            />
          </StepTransition>
        ) : null}

        {/* 首次连接的主机密钥确认：应用内 Modal，不依赖 WebView 的原生 confirm */}
        <Modal
          open={pendingHostKey !== null}
          onClose={rejectPendingHostKey}
          title="首次连接：确认服务器身份"
          description={
            pendingHostKey
              ? `${pendingHostKey.host}:${pendingHostKey.port} 尚未出现在 known_hosts 中。`
              : undefined
          }
          size="md"
          footer={
            <>
              <Button variant="secondary" onClick={rejectPendingHostKey}>
                取消
              </Button>
              <Button variant="primary" onClick={confirmPendingHostKey}>
                指纹一致，信任此服务器
              </Button>
            </>
          }
        >
          <p>
            请先通过云厂商控制台、VPS 初始化邮件或其他可信渠道核对下面的指纹。
            确认一致后才会写入 known_hosts；此后该服务器的密钥若发生变化，连接会被拒绝。
          </p>
          <dl className="mt-4 space-y-3 rounded-control bg-surface-50 p-3.5 dark:bg-surface-900">
            <div>
              <dt className="text-xs text-surface-500 dark:text-surface-400">密钥算法</dt>
              <dd className="mt-0.5 font-mono text-sm text-surface-800 dark:text-surface-100">
                {pendingHostKey?.algorithm}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-surface-500 dark:text-surface-400">指纹</dt>
              <dd className="mt-0.5 break-all font-mono text-sm text-surface-800 dark:text-surface-100">
                {pendingHostKey?.fingerprint}
              </dd>
            </div>
          </dl>
          <Callout variant="warning" className="mt-4">
            如果这台服务器你以前连接过，指纹却变了，请不要信任：这可能是中间人攻击。
          </Callout>
        </Modal>

        {step === 3 && node && subscription ? (
          <StepTransition key={3}>
            <SubscriptionView
              node={node}
              uri={subscription.uri}
              qrSvg={subscription.qrSvg}
              managedUri={subscription.managedUri}
              managedQrSvg={subscription.managedQrSvg}
            />
            <WizardActions
              right={
                <Button onClick={() => navigate('/')}>完成并返回列表</Button>
              }
            />
          </StepTransition>
        ) : null}
      </div>
    </PageShell>
  );
}
