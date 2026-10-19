import type {TurboModule, CodegenTypes} from 'react-native';
import {TurboModuleRegistry} from 'react-native';
type Change = {sequence: number; observedAt: string};
type Money = {currency: string; amountMinor: string};
type Operation = {operationId: string; kind: string; status: string; updatedAt: string; resultId: string | null};
export type SummaryQuery = {startDate: string; endDate: string};
export type DetailQuery = {id: string; cursor: string | null; limit: number};
export type ClassifyRequest = {operationId: string; id: string; expectedRevision: number; classification: string};
export type Stream = {id: string; accountId: string; currency: string; merchantName: string | null; merchantEntityId: string | null; frequency: string; sourceFrequency: string | null; classification: string; sourceStatus: string; isOutflow: boolean; firstDate: string | null; lastDate: string | null; averageAmountMinor: string | null; lastAmountMinor: string | null; predictedAmountMinor: string | null; predictedNextDate: string | null; sourceUpdatedAt: string | null; revision: number};
export type Page = {items: Stream[]; nextCursor: string | null; limit: number; state: string; checkedAt: string | null; sourceUpdatedAt: string | null; lastError: string | null; coverageWarnings: string[]};
export type Query = {cursor: string | null; limit: number; currency: string | null; classification: string | null};
export type History = {providerTransactionId: string; pendingProviderTransactionId: string | null; date: string; amountMinor: string; currency: string; status: string; kind: string};
export type Detail = {stream: Stream; history: History[]; nextCursor: string | null; limit: number; classification: string};
export type Upcoming = {stream: Stream; nextExpectedAmountMinor: string | null};
export type Summary = {monthlyByCurrency: Money[]; yearlyByCurrency: Money[]; subscriptionByCurrency: Money[]; actualCostByCurrency: Money[]; upcoming: Upcoming[]; latestPaymentChanges: Stream[]; streamCount: number; coverageWarnings: string[]; checkedAt: string | null; sourceUpdatedAt: string | null; lastError: string | null; state: string};
export interface Spec extends TurboModule {
  readPage(query: Query): Promise<Page>;
  readSummary(query: SummaryQuery): Promise<Summary>;
  readDetail(query: DetailQuery): Promise<Detail>;
  startClassify(request: ClassifyRequest): Promise<Operation>;
  readonly onChanged: CodegenTypes.EventEmitter<Change>;
}
export default TurboModuleRegistry.getEnforcing<Spec>('NativeRecurring');
