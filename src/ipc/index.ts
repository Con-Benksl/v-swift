import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  ConnectionTarget,
  DeployEvent,
  DeployParams,
  NodeRecord,
  OsInfo,
  SubscriptionResult,
  VpsProfileSummary,
} from './types';

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
  const unlisten: UnlistenFn = await listen<DeployEvent>('deploy-event', (event) => {
    onEvent(event.payload);
  });

  try {
    return await invoke<NodeRecord>('deploy_node', { params });
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

export async function uninstallNode(id: string): Promise<void> {
  await invoke('uninstall_node', { id });
}

export async function forgetVpsProfile(id: string): Promise<void> {
  await invoke('forget_vps_profile', { id });
}

export async function forgetOrphanVpsProfiles(): Promise<number> {
  return invoke<number>('forget_orphan_vps_profiles');
}
