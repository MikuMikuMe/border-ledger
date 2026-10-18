import type {TurboModule, CodegenTypes} from 'react-native';
import {TurboModuleRegistry} from 'react-native';
type Operation = {operationId: string; kind: string; status: string; updatedAt: string; resultId: string | null};
export type SessionSnapshot = {state: string; expiresAt: string | null; pendingDestination: string | null; reason: string | null; pendingRevocations: number; environment: string};
export interface Spec extends TurboModule {
  getSnapshot(): Promise<SessionSnapshot>;
  refreshOnResume(): Promise<SessionSnapshot>;
  beginLogin(staySignedIn: boolean, pendingDestination: string | null): Promise<SessionSnapshot>;
  signOut(): Promise<SessionSnapshot>;
  consumePendingDestination(): Promise<string | null>;
  queryOperation(operationId: string): Promise<Operation | null>;
  readOperations(offset: number, limit: number): Promise<Operation[]>;
  cancelOperation(operationId: string): Promise<Operation | null>;
  readonly onStateChanged: CodegenTypes.EventEmitter<SessionSnapshot>;
}
export default TurboModuleRegistry.getEnforcing<Spec>('NativeSession');
