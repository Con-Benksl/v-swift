export type AuthMethod =
  | { kind: 'password'; password: string }
  | { kind: 'privateKey'; key: string; passphrase?: string };

export interface VpsCredential {
  host: string;
  port: number;
  user: string;
  auth: AuthMethod;
}

export interface ConnectionTarget {
  vpsProfileId?: string;
  credential?: VpsCredential;
}

export interface OsInfo {
  distro: string;
  version: string;
  arch: string;
}

export type ProtocolId = 'vless-reality' | 'hysteria2';

export interface DeployParams {
  vpsProfileId?: string;
  vpsName: string;
  credential?: VpsCredential;
  protocol: ProtocolId;
  port: number;
  nodeName: string;
  sni?: string;
}

export type NodeStatus = 'active' | 'uninstalled' | 'unknown';

export interface NodeRecord {
  id: string;
  vpsId: string;
  vpsName: string;
  name: string;
  host: string;
  sshPort: number;
  sshUser: string;
  protocol: ProtocolId;
  protocolParams: Record<string, unknown>;
  status: NodeStatus;
  createdAt: number;
}

export interface SubscriptionResult {
  uri: string;
  qrSvg: string;
  managedUri?: string;
  managedQrSvg?: string;
}

export interface VpsProfileSummary {
  id: string;
  name: string;
  host: string;
  sshPort: number;
  sshUser: string;
  createdAt: number;
  nodeCount: number;
  credentialAvailable: boolean;
}

export type DeployEvent =
  | { kind: 'step'; step: string; label: string }
  | { kind: 'log'; line: string }
  | { kind: 'done'; node: NodeRecord }
  | { kind: 'error'; step: string; message: string }
  | { kind: 'warning'; step: string; message: string };
