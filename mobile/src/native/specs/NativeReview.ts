import type {TurboModule, CodegenTypes} from 'react-native';
import {TurboModuleRegistry} from 'react-native';
type Change = {sequence: number; observedAt: string};
type Money = {currency: string; amountMinor: string};
type Operation = {operationId: string; kind: string; status: string; updatedAt: string; resultId: string | null};
export type AlertsQuery = {cursor: string | null; limit: number};
export type Provenance = {sourceKind: string; sourceId: string; basis: string; revision: number};
export type SourceEvidence = {sourceProfileId: string; parserVersion: string; eventTimeBasis: string; capturedAt: string; notificationPostedAt: string | null; bankReference: string | null; merchant: string | null; eventMoney: Money | null};
export type Comparison = {id: string; date: string; merchant: string; amountMinor: string; currency: string; kind: string; status: string; source: string};
export type Candidate = {id: string; statementTransactionId: string; candidateTransactionId: string; score: number; reasonCodes: string[]; status: string; evidenceBasis: string; relation: string | null; targetTransaction: Comparison};
export type Link = {id: string; targetEventId: string | null; targetTransactionId: string | null; relation: string; allocatedMoney: Money | null; evidenceBasis: string; revision: number};
export type LinkAction = {targetId: string; candidateTransactionId: string; relation: string; allocatedMoney: Money | null};
export type Annotation = {transactionId: string; expectedRevision: number; category: string; note: string | null};
export type ReviewRequest = {operationId: string; value: Decision};
export type AnnotationRequest = {operationId: string; value: Annotation};
export type Alert = {eventId: string; eventType: string; state: string; countedMoney: Money | null; reportingDate: string | null; revision: number; reasonCodes: string[]; sourceEvidence: SourceEvidence | null; provenance: Provenance[]; affectedMoney: Money | null; candidates: Candidate[]; links: Link[]; linkAction: LinkAction | null; linkDisabledReason: string | null; transactionId: string | null; annotation: Annotation | null; annotationDisabledReason: string | null};
export type Page = {items: Alert[]; nextCursor: string | null; limit: number};
export type Decision = {eventId: string; expectedRevision: number; decision: string; targetId: string | null; candidateTransactionId: string | null; relation: string | null; allocatedMoney: Money | null};
export interface Spec extends TurboModule {
  readAlerts(query: AlertsQuery): Promise<Page>;
  startReview(request: ReviewRequest): Promise<Operation>;
  startAnnotate(request: AnnotationRequest): Promise<Operation>;
  readonly onChanged: CodegenTypes.EventEmitter<Change>;
}
export default TurboModuleRegistry.getEnforcing<Spec>('NativeReview');
