import type {TurboModule, CodegenTypes} from 'react-native';
import {TurboModuleRegistry} from 'react-native';
type Change = {sequence: number; observedAt: string};
type Operation = {operationId: string; kind: string; status: string; updatedAt: string; resultId: string | null};
export type Transaction = {id: string; occurredAt: string; currency: string; signedMinorUnits: string; merchant: string | null; accountLabel: string | null; status: string; sourceLabel: string | null; category: string | null; note: string | null; kind: string; revision: number; accountId: string | null};
export type Transactions = {items: Transaction[]; nextCursor: string | null; limit: number};
export type ActivityQuery = {cursor: string | null; limit: number; query: string | null; currency: string | null; status: string | null; source: string | null; category: string | null};
export type ReportQuery = {startDate: string; endDate: string; includeProvisional: boolean; currency: string | null; reportingCurrency: string | null; timeZone: string};
export type CurrencyTotal = {currency: string; confirmedMinorUnits: string; provisionalMinorUnits: string; confirmedCount: number; provisionalCount: number};
export type DailyTotal = {date: string; currency: string; confirmedMinorUnits: string; provisionalMinorUnits: string};
export type ConvertedTotal = {confirmedMinorUnits: string; provisionalMinorUnits: string; confirmedCount: number; provisionalCount: number};
export type ConvertedDaily = {date: string; confirmedMinorUnits: string; provisionalMinorUnits: string};
export type FxBand = {eligible: boolean; currency: string; baseMinorUnits: string; lowerMinorUnits: string; upperMinorUnits: string; percentageBasisPoints: number};
export type Fx = {provider: string; complete: boolean; unavailableSourceCurrencies: string[]; lockedDateCount: number; earliest: string | null; latest: string | null; chineseBankBand: FxBand | null};
export type Coverage = {source: string; count: number};
export type Report = {timeBasis: string; currencyTotals: CurrencyTotal[]; dailyTotals: DailyTotal[]; reviewCount: number; excludedCount: number; from: string | null; to: string | null; includeProvisional: boolean; timeZone: string | null; asOf: string | null; sourceCoverage: Coverage[]; reportingCurrency: string | null; convertedTotals: ConvertedTotal | null; convertedDailyTotals: ConvertedDaily[]; fx: Fx};
export type LedgerAccount = {id: string; displayName: string; institution: string | null; instrument: string | null; currencies: string[]; lastSuccessfulSyncAt: string | null};
export type RecurringOverview = {id: string; label: string; currency: string; monthlyMinorUnits: string | null; classification: string | null; nextDueAt: string | null};
export type ReviewOverview = {id: string; reason: string; currency: string | null; affectedMinorUnits: string | null; candidateLabel: string | null; status: string};
export type Snapshot = {schemaVersion: number; snapshotAt: string; timeZone: string; accounts: LedgerAccount[]; transactions: Transaction[]; recurring: RecurringOverview[]; reviews: ReviewOverview[]; report: Report | null};
export interface Spec extends TurboModule {
  getSnapshot(): Promise<Snapshot | null>;
  refreshSnapshot(): Promise<Snapshot | null>;
  readTransactions(query: ActivityQuery): Promise<Transactions>;
  readReport(query: ReportQuery): Promise<Report>;
  startCaptureSync(operationId: string): Promise<Operation>;
  readonly onChanged: CodegenTypes.EventEmitter<Change>;
}
export default TurboModuleRegistry.getEnforcing<Spec>('NativeLedger');
