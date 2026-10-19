import type {TurboModule, CodegenTypes} from 'react-native';
import {TurboModuleRegistry} from 'react-native';
type Operation = {operationId: string; kind: string; status: string; updatedAt: string; resultId: string | null};
export type ImportRowsQuery = {offset: number; limit: number};
export type PickImportRequest = {operationId: string; accountId: string};
export type RowSelectionRequest = {rowId: string; selected: boolean};
export type DuplicateDecisionRequest = {operationId: string; candidateId: string; decision: string};
export type ImportOperationRequest = {operationId: string};
export type ImportRow = {rowId: string; rowIndex: number; accountId: string; date: string; merchant: string; amountMinor: string; currency: string; category: string; kind: string; status: string; selected: boolean};
export type Duplicate = {id: string; statementTransactionId: string; candidateTransactionId: string; score: number; reasonCodes: string[]; status: string};
export type FileSnapshot = {importState: string; exportState: string; previewId: string | null; revision: number | null; expiresAt: string | null; rowCount: number; selectedRowCount: number; duplicates: Duplicate[]; errors: string[]; importReceiptId: string | null; exportReceiptId: string | null};
export type RowPage = {items: ImportRow[]; offset: number; total: number};
export type ExportRequest = {operationId: string; selection: string; currency: string | null; startDate: string | null; endDate: string | null; share: boolean};
export interface Spec extends TurboModule {
  getSnapshot(): Promise<FileSnapshot>;
  readImportRows(query: ImportRowsQuery): Promise<RowPage>;
  startPickImport(request: PickImportRequest): Promise<Operation>;
  setRowSelected(request: RowSelectionRequest): Promise<FileSnapshot>;
  startDecideDuplicate(request: DuplicateDecisionRequest): Promise<Operation>;
  startCommitImport(request: ImportOperationRequest): Promise<Operation>;
  startCancelImport(request: ImportOperationRequest): Promise<Operation>;
  startExport(request: ExportRequest): Promise<Operation>;
  readonly onStateChanged: CodegenTypes.EventEmitter<FileSnapshot>;
}
export default TurboModuleRegistry.getEnforcing<Spec>('NativeFiles');
