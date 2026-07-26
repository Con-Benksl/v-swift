import { invoke } from './invoke';

export interface SystemStatus {
  cpuPercent: number;
  memoryTotal: number;
  memoryUsed: number;
  memoryFree: number;
  memoryAvailable: number;
  diskTotal: number;
  diskUsed: number;
  diskAvailable: number;
  diskUsagePercent: number;
  uptimeSeconds: number;
}

export interface NetworkStats {
  bytesReceived: number;
  bytesSent: number;
  packetsReceived: number;
  packetsSent: number;
}

export interface ServiceStatus {
  name: string;
  protocol: string;
  /** 后端从 systemd 状态里尽力解析；解析不出时为 null（`Option<u16>` 序列化结果）。 */
  port: number | null;
  active: boolean;
  running: boolean;
}

export type ConnectionStatus =
  | { status: 'disconnected' }
  | { status: 'connecting' }
  | { status: 'connected' }
  | { status: 'error'; message: string };

export async function getSystemStatus(vpsId: string): Promise<SystemStatus> {
  return invoke<SystemStatus>('get_system_status', { vpsId });
}

export async function getNetworkStats(vpsId: string): Promise<NetworkStats> {
  return invoke<NetworkStats>('get_network_stats', { vpsId });
}

export async function getServiceStatus(vpsId: string, protocol: string): Promise<ServiceStatus> {
  return invoke<ServiceStatus>('get_service_status', { vpsId, protocol });
}

export async function getAllServiceStatuses(vpsId: string): Promise<ServiceStatus[]> {
  return invoke<ServiceStatus[]>('get_all_service_statuses', { vpsId });
}

export async function restartService(vpsId: string, protocol: string): Promise<void> {
  await invoke('restart_service', { vpsId, protocol });
}

export async function startService(vpsId: string, protocol: string): Promise<void> {
  await invoke('start_service', { vpsId, protocol });
}

export async function stopService(vpsId: string, protocol: string): Promise<void> {
  await invoke('stop_service', { vpsId, protocol });
}

export async function getServiceLogs(vpsId: string, protocol: string): Promise<string[]> {
  return invoke<string[]>('get_service_logs', { vpsId, protocol });
}

export async function connectVps(vpsId: string): Promise<void> {
  await invoke('connect_vps', { vpsId });
}

export async function disconnectVps(vpsId: string): Promise<void> {
  await invoke('disconnect_vps', { vpsId });
}
