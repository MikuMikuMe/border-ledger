import type {TurboModule, CodegenTypes} from 'react-native';
import {TurboModuleRegistry} from 'react-native';
type Operation = {operationId: string; kind: string; status: string; updatedAt: string; resultId: string | null};
export type Account = {providerAccountId: string; name: string; mask: string | null; subtype: string | null; currency: string; kind: string};
export type AccountPage = {accounts: Account[]; nextCursor: string | null; limit: number};
export type Connection = {connectionId: string; institution: string | null; state: string; expiresAt: string | null; cleanupState: string | null; lastSyncedAt: string | null; lastError: string | null};
export type LinkSnapshot = {state: string; outcomeCode: string | null; operationId: string | null; canCancel: boolean; pendingConnectionId: string | null; connectionId: string | null; accounts: Account[]};
export interface Spec extends TurboModule {
  getSnapshot(): Promise<LinkSnapshot>;
  readAccounts(cursor: string | null, limit: number): Promise<AccountPage>;
  readConnections(): Promise<Connection[]>;
  startConnect(operationId: string, reconnectConnectionId: string | null): Promise<Operation>;
  cancelConnect(operationId: string): Promise<Operation>;
  startSelectAccounts(operationId: string, pendingConnectionId: string, accountIds: string[]): Promise<Operation>;
  startCancelPending(operationId: string, pendingConnectionId: string): Promise<Operation>;
  startSync(operationId: string): Promise<Operation>;
  startDisconnect(operationId: string, connectionId: string): Promise<Operation>;
  readonly onStateChanged: CodegenTypes.EventEmitter<LinkSnapshot>;
}
export default TurboModuleRegistry.getEnforcing<Spec>('NativeAccounts');
