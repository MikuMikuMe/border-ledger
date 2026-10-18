import type {TurboModule, CodegenTypes} from 'react-native';
import {TurboModuleRegistry} from 'react-native';
type Operation = {operationId: string; kind: string; status: string; updatedAt: string; resultId: string | null};
export type Hint = {kind: string; value: string};
export type Mapping = {sourceProfileId: string; accountId: string; allowedCurrencies: string[]; instrumentHint: Hint | null};
export type Config = {expectedRevision: number; mappings: Mapping[]};
export type Device = {id: string; name: string; platform: string; status: string; credentialExpiresAt: string | null; revokedAt: string | null; sourceMappings: Mapping[]; revision: number};
export type Profile = {sourceProfileId: string; displayName: string; accountId: string; instrumentLabel: string; currencies: string[]};
export type RuntimeHealth = {listenerPermission: string; listenerConnected: boolean; appPostingNotificationPermission: string; firstUnlock: string; storage: string; source: string; intake: string; upload: string; pendingCount: number; storedIntakeCount: number; pendingLimit: number; uploadRetryAttempt: number; uploadRetryMaxAttempts: number; uploadRetryAt: string | null; lastSuccessfulUploadAt: string | null; lastCacheSnapshotAt: string | null; pairingRenewalRequired: boolean};
export type CaptureSnapshot = {health: string; apiHealth: string; profiles: Profile[]; selectedSourceProfileId: string | null; selectedCurrency: string | null; notificationAccess: string; appNotificationPermission: string; sourceTest: string; consentRecorded: boolean; credentialExpiresAt: string | null; sourceConfigRevision: number | null; sourceSetupStatus: string};
export interface Spec extends TurboModule {
  getSnapshot(): Promise<CaptureSnapshot>;
  getRuntimeHealth(): Promise<RuntimeHealth>;
  refresh(): Promise<CaptureSnapshot>;
  readDevices(): Promise<Device[]>;
  selectSource(sourceProfileId: string, currency: string): Promise<CaptureSnapshot>;
  requestSourceTest(): Promise<CaptureSnapshot>;
  openNotificationSettings(): Promise<void>;
  openAppNotificationSettings(): Promise<void>;
  startAuthorizeCapture(operationId: string, consent: boolean): Promise<Operation>;
  startRevokeDevice(operationId: string, deviceId: string): Promise<Operation>;
  startReplaceSourceConfig(operationId: string, config: Config): Promise<Operation>;
  startAuthorizeDevice(operationId: string, config: Config): Promise<Operation>;
  readonly onStateChanged: CodegenTypes.EventEmitter<CaptureSnapshot>;
  readonly onHealthChanged: CodegenTypes.EventEmitter<RuntimeHealth>;
}
export default TurboModuleRegistry.getEnforcing<Spec>('NativeCaptureDevices');
