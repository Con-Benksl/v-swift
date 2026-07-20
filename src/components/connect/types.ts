import { VpsCredential } from '../../ipc/types';

/**
 * ConnectForm 的受控值。由 NewNodeWizard 持有，ConnectForm 及其子组件读写。
 */
export interface ConnectFormValue {
  mode: 'saved' | 'manual';
  vpsProfileId?: string;
  vpsName: string;
  host: string;
  port: number;
  user: string;
  auth: VpsCredential['auth'];
}
