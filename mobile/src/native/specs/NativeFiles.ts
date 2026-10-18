import type {TurboModule, CodegenTypes} from 'react-native';
import {TurboModuleRegistry} from 'react-native';
type Operation = {operationId: string; kind: string; status: string; updatedAt: string; resultId: string | null};
export type ImportRow = {rowId: string; rowIndex: number; accountId: string; date: string; merchant: string; amountMinor: string; currency: string; category: string; kind: string; status: string; selected: boolean};
export type Duplicate = {id: string; statementTransactionId: string; candidateTransactionId: string; score: number; reasonCodes: string[]; status: string};
export type FileSnapshot = {importState: string; exportState: string; previewId: string | null; revision: number | null; expiresAt: string | null; rowCount: number; selectedRowCount: number; duplicates: Duplicate[]; errors: string[]; importReceiptId: string | null; exportReceiptId: string | null};
export type RowPage = {items: ImportRow[]; offset: number; total: number};
export type ExportRequest = {selection: string; currency: string | null; startDate: string | null; endDate: string | null; share: boolean};
export interface Spec extends TurboModule {
  getSnapshot(): Promise<FileSnapshot>;
  readImportRows(offset: number, limit: number): Promise<RowPage>;
  startPickImport(operationId: string, accountId: string): Promise<Operation>;
  setRowSelected(rowId: string, selected: boolean): Promise<FileSnapshot>;
  startDecideDuplicate(operationId: string, candidateId: string, decision: string): Promise<Operation>;
  startCommitImport(operationId: string): Promise<Operation>;
  startCancelImport(operationId: string): Promise<Operation>;
  startExport(operationId: string, request: ExportRequest): Promise<Operation>;
  readonly onStateChanged: CodegenTypes.EventEmitter<FileSnapshot>;
}
export default TurboModuleRegistry.getEnforcing<Spec>('NativeFiles');
