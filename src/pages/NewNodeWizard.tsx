import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ConnectForm, { ConnectFormValue } from '../components/ConnectForm';
import DeployProgress from '../components/DeployProgress';
import ProtocolPicker, { ProtocolPickerValue } from '../components/ProtocolPicker';
import SubscriptionView from '../components/SubscriptionView';
import { detectOs, getSubscription, listVpsProfiles, testConnection } from '../ipc';
import {
  ConnectionTarget,
  DeployEvent,
  DeployParams,
  NodeRecord,
  OsInfo,
  VpsCredential,
  VpsProfileSummary,
} from '../ipc/types';

const steps = [
  { id: 0, title: '选择 VPS' },
  { id: 1, title: '命名节点' },
  { id: 2, title: '部署节点' },
  { id: 3, title: '查看订阅' },
];

function randomPort() {
  return Math.floor(Math.random() * (60000 - 10000 + 1)) + 10000;
}

function mapConnectionError(error: unknown): string {
  let kind = '';
  let detail = '';

  if (error instanceof Error) {
    detail = error.message;
  } else if (typeof error === 'string') {
    detail = error;
  } else if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    if (typeof obj.kind === 'string') kind = obj.kind;
    if (typeof obj.message === 'string') {
      detail = obj.message;
    } else if (obj.message && typeof obj.message === 'object') {
      const inner = obj.message as Record<string, unknown>;
      if (typeof inner.message === 'string') detail = inner.message;
    }
    if (!detail) {
      try {
        detail = JSON.stringify(error);
      } catch {
        detail = '';
      }
    }
  }

  const haystack = `${kind} ${detail}`;
  if (kind === 'AuthFailed' || haystack.includes('AuthFailed')) {
    return '认证失败，请检查用户名、密码或私钥。';
  }
  if (kind === 'HostUnreachable' || haystack.includes('HostUnreachable')) {
    return `目标主机不可达：${detail || '请检查 IP、端口和安全组。'}`;
  }
  if (kind === 'NetworkTimeout' || haystack.includes('NetworkTimeout')) {
    return '连接超时：服务器在 15 秒内没有响应（可能下线、端口被封或路由不通）。';
  }
  if (kind === 'SshHostKey' || haystack.includes('SshHostKey')) {
    return `SSH 主机密钥校验失败：${detail || '服务器身份和已信任记录不一致。'}`;
  }
  if (kind && detail) return `${kind}: ${detail}`;
  return detail || kind || '连接失败';
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
    port: randomPort(),
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

export default function NewNodeWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [credential, setCredential] = useState<ConnectFormValue>(baseCredential);
  const [protocol, setProtocol] = useState<ProtocolPickerValue>(baseProtocol);
  const [profiles, setProfiles] = useState<VpsProfileSummary[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [profilesError, setProfilesError] = useState('');
  const [testState, setTestState] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle');
  const [testError, setTestError] = useState('');
  const [osInfo, setOsInfo] = useState<OsInfo | null>(null);
  const [events, setEvents] = useState<DeployEvent[]>([]);
  const [currentStep, setCurrentStep] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [deployAttempt, setDeployAttempt] = useState(0);
  const [node, setNode] = useState<NodeRecord | null>(null);
  const [subscription, setSubscription] = useState<{ uri: string; qrSvg: string } | null>(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(false);
  const [subscriptionError, setSubscriptionError] = useState('');

  const [profilesRefreshTick, setProfilesRefreshTick] = useState(0);

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
        setCredential((prev) => {
          const availableProfiles = records.filter((item) => item.credentialAvailable);

          if (availableProfiles.length === 0) {
            return prev.mode === 'saved'
              ? { ...prev, mode: 'manual', vpsProfileId: undefined }
              : prev;
          }

          if (prev.mode !== 'saved') {
            return prev;
          }

          const selected =
            availableProfiles.find((item) => item.id === prev.vpsProfileId) ??
            availableProfiles[0];
          return {
            ...prev,
            vpsProfileId: selected.id,
            vpsName: prev.vpsName.trim() ? prev.vpsName : selected.name,
          };
        });
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
      : !!credential.host.trim() && !!credential.user.trim() && credential.port > 0);

  const minProtocolPort = protocol.protocol === 'vless-reality' ? 1024 : 1;
  const protocolValid =
    !!protocol.nodeName.trim() &&
    protocol.port >= minProtocolPort &&
    protocol.port <= 65535 &&
    (protocol.protocol !== 'vless-reality' || !!protocol.sni.trim());

  const handleCredentialChange = (nextValue: ConnectFormValue) => {
    setCredential(nextValue);
    setTestState('idle');
    setTestError('');
    setOsInfo(null);
  };

  const handleTestConnection = () => {
    setTestState('loading');
    setTestError('');
    setOsInfo(null);

    const target = buildConnectionTarget(credential);

    void testConnection(target)
      .then(() => detectOs(target))
      .then((info) => {
        setOsInfo(info);
        setTestState('ok');
      })
      .catch((error) => {
        setTestError(mapConnectionError(error));
        setTestState('err');
      });
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
    }
  };

  const handleDeployComplete = (record: NodeRecord) => {
    setNode(record);
    setCurrentStep('done');
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

  const restartDeploy = () => {
    setEvents([]);
    setCurrentStep('');
    setErrorMsg('');
    setNode(null);
    setSubscription(null);
    setSubscriptionError('');
    setSubscriptionLoading(false);
    setDeployAttempt((value) => value + 1);
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(37,99,235,0.16),_transparent_32%),linear-gradient(180deg,_#f8fafc_0%,_#dbeafe_55%,_#eff6ff_100%)] px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <section className="rounded-[2rem] border border-white/70 bg-white/80 p-8 shadow-xl shadow-blue-200/30 backdrop-blur">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-600">
                部署向导
              </p>
              <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">新建节点</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
                先选择或复用一台 VPS，再单独为本次协议实例命名并自动部署。
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-blue-300 hover:text-blue-700"
            >
              返回列表
            </button>
          </div>

          <div className="mt-8 grid gap-4 lg:grid-cols-4">
            {steps.map((item) => {
              const active = item.id === step;
              const completed = item.id < step;

              return (
                <div
                  key={item.id}
                  className={`rounded-3xl border px-4 py-4 transition ${
                    active
                      ? 'border-blue-500 bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                      : completed
                        ? 'border-blue-200 bg-blue-50 text-blue-800'
                        : 'border-slate-200 bg-slate-50 text-slate-500'
                  }`}
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.2em]">
                    {completed ? '已完成' : active ? '进行中' : '待处理'}
                  </p>
                  <div className="mt-3 flex items-center gap-3">
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold ${
                        active
                          ? 'bg-white/15 text-white'
                          : completed
                            ? 'bg-blue-600 text-white'
                            : 'bg-white text-slate-400'
                      }`}
                    >
                      {completed ? '✓' : item.id + 1}
                    </span>
                    <span className="text-sm font-medium">{item.title}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="mt-8">
          {step === 0 ? (
            <div className="space-y-6">
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
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  disabled={!canContinueFromConnect}
                  className="rounded-2xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  下一步：命名节点
                </button>
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-6">
              <ProtocolPicker value={protocol} onChange={setProtocol} />
              <div className="flex flex-wrap justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setStep(0)}
                  className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-blue-300 hover:text-blue-700"
                >
                  返回 VPS 设置
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEvents([]);
                    setCurrentStep('');
                    setErrorMsg('');
                    setNode(null);
                    setSubscription(null);
                    setSubscriptionError('');
                    setSubscriptionLoading(false);
                    setDeployAttempt((value) => value + 1);
                    setStep(2);
                  }}
                  disabled={!protocolValid}
                  className="rounded-2xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  开始部署
                </button>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-6">
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
              <div className="flex justify-between">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-blue-300 hover:text-blue-700"
                >
                  返回协议设置
                </button>
                {subscriptionLoading ? (
                  <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                    部署完成，正在获取订阅信息...
                  </div>
                ) : null}
                {subscriptionError ? (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {subscriptionError}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {step === 3 && node && subscription ? (
            <div className="space-y-6">
              <SubscriptionView node={node} uri={subscription.uri} qrSvg={subscription.qrSvg} />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => navigate('/')}
                  className="rounded-2xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-500"
                >
                  完成并返回列表
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
