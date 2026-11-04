import type { TurboModule, CodegenTypes } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export type Operation = { operationId: string; kind: string; status: string; updatedAt: string; resultId: string | null };
export type WealthReadRequest = {
  view?: 'overview' | 'investments' | 'cash-flow';
  accountId?: string | null;
  exchange?: string | null;
  ticker?: string | null;
  asOf?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
};
export type WealthHistoryRequest = {accountId?: string | null};

export interface Spec extends TurboModule {
  createIdentifier(): string;
  readSnapshot(request: WealthReadRequest): Promise<string>;
  readQuoteSettings(): Promise<string>;
  readEvents(request: WealthHistoryRequest): Promise<string>;
  readValuations(request: WealthHistoryRequest): Promise<string>;
  readTemplate(): Promise<string>;
  startCsvImport(operationId: string): Promise<Operation>;
  startCsvTemplate(operationId: string): Promise<Operation>;
  startCsvRemap(sourceOperationId: string, operationId: string, mapping: string): Promise<Operation>;
  readCsvPreview(operationId: string): Promise<string | null>;
  startWrite(operationId: string, action: string, body: string): Promise<Operation>;
  readonly onStateChanged: CodegenTypes.EventEmitter<string>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('NativeWealth');
