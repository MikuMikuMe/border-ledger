import type {TurboModule, CodegenTypes} from 'react-native';
import {TurboModuleRegistry} from 'react-native';
type Operation = {operationId: string; kind: string; status: string; updatedAt: string; resultId: string | null};
export type Display = {appearanceMode: string; filter: string; reducedMotion: boolean};
export type Reporting = {reportingTimezone: string; weekStart: number; preferredCurrency: string | null; revision: number; updatedAt: string | null};
export type ReportingUpdate = {reportingTimezone: string; weekStart: number; preferredCurrency: string | null};
export interface Spec extends TurboModule {
  getSnapshot(): Promise<Display>;
  updateDisplay(value: Display): Promise<Display>;
  readReporting(): Promise<Reporting>;
  startUpdateReporting(operationId: string, expectedRevision: number, value: ReportingUpdate): Promise<Operation>;
  readonly onChanged: CodegenTypes.EventEmitter<Display>;
}
export default TurboModuleRegistry.getEnforcing<Spec>('NativePreferences');
