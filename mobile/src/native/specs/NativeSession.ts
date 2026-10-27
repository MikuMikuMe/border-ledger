import type {TurboModule, CodegenTypes} from 'react-native';
import {TurboModuleRegistry} from 'react-native';
type Operation = {operationId: string; kind: string; status: string; updatedAt: string; resultId: string | null};
export type LoginRequest = {staySignedIn: boolean; pendingDestination: string | null};
export type OperationRequest = {operationId: string};
export type OperationPageQuery = {offset: number; limit: number};
export type SessionSnapshot = {userId: string | null; ledgerId: string | null; sessionEpoch: string | null; state: string; expiresAt: string | null; pendingDestination: string | null; reason: string | null; pendingRevocations: number; environment: string};
export interface Spec extends TurboModule {
  getSnapshot(): Promise<SessionSnapshot>;
  refreshOnResume(): Promise<SessionSnapshot>;
  beginLogin(request: LoginRequest): Promise<SessionSnapshot>;
  signOut(): Promise<SessionSnapshot>;
  consumePendingDestination(): Promise<string | null>;
  queryOperation(request: OperationRequest): Promise<Operation | null>;
  readOperations(query: OperationPageQuery): Promise<Operation[]>;
  cancelOperation(request: OperationRequest): Promise<Operation | null>;
  readonly onStateChanged: CodegenTypes.EventEmitter<SessionSnapshot>;
}
export default TurboModuleRegistry.getEnforcing<Spec>('NativeSession');
