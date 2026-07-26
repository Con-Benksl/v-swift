/**
 * 浏览器开发模式的 IPC mock（仅 import.meta.env.DEV 且非 Tauri 环境时被 invoke.ts 启用）。
 * 目的：让 `npm run dev` 在纯浏览器里可以走完全部页面与部署流程，便于前端迭代与视觉验收。
 * 不参与生产构建逻辑：Tauri 环境下 invoke.ts 直接走真实后端。
 */
import type {
  DeployEvent,
  DeployParams,
  NodeRecord,
  SubscriptionResult,
  VpsProfileSummary,
} from './types';
import type { NetworkStats, ServiceStatus, SystemStatus } from './control';

const now = Date.now();
const HOUR = 3_600_000;
const DAY = 86_400_000;

const mockNodes: NodeRecord[] = [
  {
    id: 'node-tokyo-vless',
    vpsId: 'vps-tokyo',
    vpsName: 'Tokyo Lightsail',
    name: '东京主力',
    host: '203.0.113.10',
    sshPort: 22,
    sshUser: 'root',
    protocol: 'vless-reality',
    protocolParams: { port: 443, sni: 'www.microsoft.com' },
    status: 'active',
    createdAt: now - 2 * DAY,
  },
  {
    id: 'node-tokyo-hy2',
    vpsId: 'vps-tokyo',
    vpsName: 'Tokyo Lightsail',
    name: '东京备用 HY2',
    host: '203.0.113.10',
    sshPort: 22,
    sshUser: 'root',
    protocol: 'hysteria2',
    protocolParams: { port: 32444 },
    status: 'active',
    createdAt: now - 26 * HOUR,
  },
  {
    id: 'node-fremont-vless',
    vpsId: 'vps-fremont',
    vpsName: 'Fremont Vultr',
    name: '美西直连',
    host: '198.51.100.20',
    sshPort: 2222,
    sshUser: 'deploy',
    protocol: 'vless-reality',
    protocolParams: { port: 443, sni: 'www.apple.com' },
    status: 'unknown',
    createdAt: now - 9 * DAY,
  },
];

const mockProfiles: VpsProfileSummary[] = [
  {
    id: 'vps-tokyo',
    name: 'Tokyo Lightsail',
    host: '203.0.113.10',
    sshPort: 22,
    sshUser: 'root',
    createdAt: now - 12 * DAY,
    nodeCount: 2,
    credentialAvailable: true,
  },
  {
    id: 'vps-fremont',
    name: 'Fremont Vultr',
    host: '198.51.100.20',
    sshPort: 2222,
    sshUser: 'deploy',
    createdAt: now - 30 * DAY,
    nodeCount: 1,
    credentialAvailable: true,
  },
];

/** 生成一个带定位角的伪二维码 SVG（deterministic，仅供视觉占位） */
function fakeQrSvg(seed: string): string {
  const size = 25;
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const rand = () => {
    hash ^= hash << 13;
    hash ^= hash >>> 17;
    hash ^= hash << 5;
    hash >>>= 0;
    return hash / 0xffffffff;
  };
  const cells: string[] = [];
  const finder = (x: number, y: number) => {
    cells.push(`<rect x="${x}" y="${y}" width="7" height="7" fill="#000"/>`);
    cells.push(`<rect x="${x + 1}" y="${y + 1}" width="5" height="5" fill="#fff"/>`);
    cells.push(`<rect x="${x + 2}" y="${y + 2}" width="3" height="3" fill="#000"/>`);
  };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inFinder =
        (x < 8 && y < 8) || (x >= size - 8 && y < 8) || (x < 8 && y >= size - 8);
      if (!inFinder && rand() > 0.55) {
        cells.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="#000"/>`);
      }
    }
  }
  finder(0, 0);
  finder(size - 7, 0);
  finder(0, size - 7);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" width="100%" height="100%"><rect width="${size}" height="${size}" fill="#fff"/>${cells.join('')}</svg>`;
}

function subscriptionFor(id: string): SubscriptionResult {
  const node = mockNodes.find((item) => item.id === id);
  const host = node?.host ?? '203.0.113.10';
  const port = Number(node?.protocolParams?.port ?? 443);
  const label = encodeURIComponent(node?.name ?? 'V-Swift 节点');
  const uri =
    node?.protocol === 'hysteria2'
      ? `hysteria2://mockPassword0000@${host}:${port}?insecure=0&sni=${host}#${label}`
      : `vless://c8f2f6da-9b4e-4f7e-8ce1-${id.slice(-8).padEnd(12, '0')}@${host}:${port}?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.microsoft.com&fp=chrome&pbk=mockPublicKey0000000000000000000000000000000&type=tcp#${label}`;
  return {
    uri,
    qrSvg: fakeQrSvg(id),
    managedUri: `https://203.0.113.10:8443/sub/mock-${id}`,
    managedQrSvg: fakeQrSvg(`managed-${id}`),
  };
}

const mockSystemStatus: SystemStatus = {
  cpuPercent: 23.4,
  memoryTotal: 2048,
  memoryUsed: 812,
  memoryFree: 1236,
  memoryAvailable: 1180,
  diskTotal: 42 * 1024 * 1024 * 1024,
  diskUsed: 11.6 * 1024 * 1024 * 1024,
  diskAvailable: 30.4 * 1024 * 1024 * 1024,
  diskUsagePercent: 27.6,
  uptimeSeconds: 18 * 24 * 3600 + 7 * 3600 + 42 * 60,
};

const mockNetworkStats: NetworkStats = {
  bytesReceived: 182.6 * 1024 * 1024 * 1024,
  bytesSent: 96.1 * 1024 * 1024 * 1024,
  packetsReceived: 214_000_000,
  packetsSent: 187_000_000,
};

const mockServices: ServiceStatus[] = [
  { name: 'Xray (VLESS Reality)', protocol: 'vless-reality', port: 443, active: true, running: true },
  { name: 'Hysteria2', protocol: 'hysteria2', port: 32444, active: true, running: false },
];

const mockLogs = [
  '2026-07-26 09:12:01 [Info] transport/internet/tcp: listening TCP on 0.0.0.0:443',
  '2026-07-26 09:12:01 [Info] core: Xray 25.6.8 started',
  '2026-07-26 09:14:32 [Info] proxy/vless/inbound: received request for tcp:www.microsoft.com:443',
  '2026-07-26 09:15:07 [Warning] transport/internet: connection closed by peer',
  '2026-07-26 09:18:44 [Info] proxy/vless/inbound: received request for tcp:github.com:443',
  '2026-07-26 09:22:10 [Error] proxy/vless/inbound: invalid request user: unknown UUID',
  '2026-07-26 09:25:33 [Info] app/router: default route matched: proxy',
];

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 已在本次预览会话里确认过指纹的主机（模拟 known_hosts） */
const trustedMockHosts = new Set<string>();

/**
 * deploy 事件监听器注册表：invoke 兼容层挂载，mock deploy_node 驱动。
 * 按 (事件名 + 递增 token) 存储：重试部署时旧监听器的 unlisten 必须只删自己，
 * 否则会把新部署刚注册的同名监听器一并删掉，新部署的事件全部丢失。
 */
let listenerToken = 0;
const deployListeners = new Map<number, { eventName: string; handler: (event: DeployEvent) => void }>();

export function registerMockListener(
  eventName: string,
  handler: (event: DeployEvent) => void,
): () => void {
  listenerToken += 1;
  const token = listenerToken;
  deployListeners.set(token, { eventName, handler });
  return () => {
    deployListeners.delete(token);
  };
}

function emitMockEvent(eventName: string, event: DeployEvent): void {
  for (const listener of deployListeners.values()) {
    if (listener.eventName === eventName) {
      listener.handler(event);
    }
  }
}

async function runMockDeploy(params: DeployParams, deploymentId: string): Promise<NodeRecord> {
  const emit = (event: DeployEvent) => emitMockEvent(`deploy-event-${deploymentId}`, event);
  const steps: Array<[string, string, number]> = [
    ['detect_os', '识别系统', 700],
    ['prepare', '准备环境', 900],
    ['install', '安装核心组件', 1200],
    ['configure', '写入配置', 800],
    ['firewall', '开放防火墙', 700],
    ['reachability', '验证公网连通性', 900],
    ['subscription', '配置托管订阅', 800],
  ];
  for (const [step, label, ms] of steps) {
    emit({ kind: 'step', step, label });
    emit({ kind: 'log', line: `[mock] ${label}…` });
    if (step === 'install') {
      emit({ kind: 'log', line: '正在下载 Xray v25.6.8…' });
      for (const received of ['3145728', '9437184', '18874368']) {
        await delay(350);
        emit({ kind: 'log', line: `下载中... 已接收 ${received}` });
      }
      emit({ kind: 'log', line: '下载完成，正在解压 Xray...' });
      await delay(300);
      emit({ kind: 'log', line: 'Xray 二进制文件已安装到 /usr/local/bin/xray。' });
    }
    await delay(ms);
    emit({ kind: 'log', line: `[mock] ${label} 完成` });
  }
  emit({ kind: 'step', step: 'done', label: '完成部署' });

  const record: NodeRecord = {
    id: `node-mock-${deploymentId}`,
    vpsId: params.vpsProfileId ?? 'vps-mock-new',
    vpsName: params.vpsName || 'Mock VPS',
    name: params.nodeName || '新节点',
    host: params.credential?.host ?? '203.0.113.10',
    sshPort: params.credential?.port ?? 22,
    sshUser: params.credential?.user ?? 'root',
    protocol: params.protocol,
    protocolParams: { port: params.port, ...(params.sni ? { sni: params.sni } : {}) },
    status: 'active',
    createdAt: Date.now(),
  };
  mockNodes.unshift(record);
  return record;
}

/** 按命令名分发的 mock invoke。未覆盖的命令抛错，便于及时发现遗漏。 */
export async function mockInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  await delay(cmd === 'deploy_node' ? 0 : 250 + Math.random() * 350);

  switch (cmd) {
    case 'list_nodes':
      return [...mockNodes] as T;
    case 'list_vps_profiles':
      return [...mockProfiles] as T;
    case 'get_node': {
      const record = mockNodes.find((node) => node.id === args?.id);
      if (!record) throw new Error(`[mock] 找不到节点 ${String(args?.id)}`);
      return record as T;
    }
    case 'get_subscription':
      return subscriptionFor(String(args?.id ?? 'unknown')) as T;
    case 'update_vps_profile_host': {
      const host = String(args?.host ?? '');
      for (const node of mockNodes) {
        if (node.vpsId === args?.id) node.host = host;
      }
      const profile = mockProfiles.find((item) => item.id === args?.id);
      if (profile) profile.host = host;
      return undefined as T;
    }
    case 'uninstall_node': {
      const index = mockNodes.findIndex((node) => node.id === args?.id);
      if (index >= 0) mockNodes.splice(index, 1);
      return { warnings: [] } as T;
    }
    case 'forget_vps_profile':
    case 'forget_orphan_vps_profiles':
      return 0 as T;
    case 'test_connection': {
      await delay(700);
      // 手动录入模式下先模拟一次「未知主机密钥」，让指纹确认弹窗在浏览器里也能走通。
      const target = args?.target as { credential?: { host?: string }; acceptNewHostKey?: boolean };
      const host = target?.credential?.host;
      if (host && !target?.acceptNewHostKey && !trustedMockHosts.has(host)) {
        throw new Error(
          `SshHostKey: UNKNOWN_SSH_HOST_KEY|host=${host}|port=22|algorithm=ssh-ed25519|fingerprint=SHA256:mockFingerprint0000000000000000000000000000`,
        );
      }
      if (host) trustedMockHosts.add(host);
      return undefined as T;
    }
    case 'detect_os':
      return { distro: 'Debian', version: '12', arch: 'x86_64' } as T;
    case 'deploy_node':
      return runMockDeploy(
        args?.params as DeployParams,
        String(args?.deploymentId ?? 'dev'),
      ) as Promise<T>;
    case 'connect_vps':
      await delay(600);
      return undefined as T;
    case 'disconnect_vps':
      return undefined as T;
    case 'get_system_status':
      return {
        ...mockSystemStatus,
        cpuPercent: Math.max(2, Math.min(97, mockSystemStatus.cpuPercent + (Math.random() - 0.5) * 8)),
      } as T;
    case 'get_network_stats':
      return mockNetworkStats as T;
    case 'get_all_service_statuses':
      return [...mockServices] as T;
    case 'restart_service':
    case 'start_service': {
      const service = mockServices.find((item) => item.protocol === args?.protocol);
      if (service) {
        service.running = true;
        service.active = true;
      }
      await delay(600);
      return undefined as T;
    }
    case 'stop_service': {
      const service = mockServices.find((item) => item.protocol === args?.protocol);
      if (service) service.running = false;
      await delay(600);
      return undefined as T;
    }
    case 'get_service_logs':
      return [...mockLogs] as T;
    case 'get_service_status': {
      const service = mockServices.find((item) => item.protocol === args?.protocol);
      if (!service) throw new Error(`[mock] 未知协议 ${String(args?.protocol)}`);
      return service as T;
    }
    case 'get_connection_status':
      return { status: 'connected' } as T;
    case 'plugin:shell|open':
      // 浏览器预览里退回 window.open，方便验证按钮接线；Tauri 下走真实系统打开。
      window.open(String(args?.path ?? ''), '_blank', 'noopener,noreferrer');
      return undefined as T;
    default:
      throw new Error(`[mock] 未覆盖的 IPC 命令：${cmd}`);
  }
}
