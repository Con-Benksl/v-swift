import { invoke, listen, type UnlistenFn } from './invoke';
import {
  ConnectionTarget,
  DeployEvent,
  DeployParams,
  NodeRecord,
  OsInfo,
  SubscriptionResult,
  UninstallOutcome,
  VpsProfileSummary,
} from './types';

let deploymentSequence = 0;

function nextDeploymentId(): string {
  deploymentSequence += 1;
  return `${Date.now().toString(36)}-${deploymentSequence.toString(36)}`;
}

function deployEventName(deploymentId: string): string {
  return `deploy-event-${deploymentId}`;
}

export async function testConnection(target: ConnectionTarget): Promise<void> {
  await invoke('test_connection', { target });
}

export async function detectOs(target: ConnectionTarget): Promise<OsInfo> {
  return invoke<OsInfo>('detect_os', { target });
}

export async function deployNode(
  params: DeployParams,
  onEvent: (event: DeployEvent) => void,
): Promise<NodeRecord> {
  const deploymentId = nextDeploymentId();
  const unlisten: UnlistenFn = await listen<DeployEvent>(deployEventName(deploymentId), (event) => {
    onEvent(event.payload);
  });

  try {
    return await invoke<NodeRecord>('deploy_node', { params, deploymentId });
  } finally {
    await unlisten();
  }
}

export async function listNodes(): Promise<NodeRecord[]> {
  return invoke<NodeRecord[]>('list_nodes');
}

export async function listVpsProfiles(): Promise<VpsProfileSummary[]> {
  return invoke<VpsProfileSummary[]>('list_vps_profiles');
}

export async function updateVpsProfileHost(id: string, host: string): Promise<void> {
  await invoke('update_vps_profile_host', { id, host });
}

export async function getNode(id: string): Promise<NodeRecord> {
  return invoke<NodeRecord>('get_node', { id });
}

export async function getSubscription(id: string): Promise<SubscriptionResult> {
  return invoke<SubscriptionResult>('get_subscription', { id });
}

export async function uninstallNode(id: string): Promise<UninstallOutcome> {
  return invoke<UninstallOutcome>('uninstall_node', { id });
}

export async function forgetVpsProfile(id: string): Promise<void> {
  await invoke('forget_vps_profile', { id });
}

export async function forgetOrphanVpsProfiles(profileIds: string[]): Promise<number> {
  return invoke<number>('forget_orphan_vps_profiles', { profileIds });
}

/**
 * 把 URL 交给操作系统打开（客户端一键导入用的 `v2rayn://` 等自定义 scheme）。
 *
 * 不能用 `window.open`：WebView 不会像浏览器那样把未知 scheme 转交系统，
 * 导航会被直接取消，按钮表现为「点了没反应」。允许的 scheme 由
 * `tauri.conf.json` 的 `plugins.shell.open` 正则限定。
 */
export async function openExternal(url: string): Promise<void> {
  await invoke('plugin:shell|open', { path: url });
}
