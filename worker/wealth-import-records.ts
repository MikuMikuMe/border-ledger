import type { CanonicalInstrument, HoldingValuation, WealthAccount, WealthEvent } from '../src/domain/wealth-types';
import type { CsvPreviewRow, PreviewClassificationContext, WealthImportRecord } from './wealth-import-types';
import { transitionOpeningEventCount } from './wealth-import-transitions';

export interface RecordIdentityTools {
  readonly accountValueKey: string;
  readonly instrumentKey: (instrument: CanonicalInstrument) => string;
  readonly stable: (value: unknown) => string;
  readonly canonicalEventFingerprint: (event: WealthEvent) => string;
}

export interface PreviewRowContext {
  readonly rowId: string;
  readonly rowIndex: number;
  readonly record: WealthImportRecord;
  readonly error?: string | null;
  readonly duplicateOf?: string | null;
}

export interface PreviewCollectionContext {
  readonly headers: readonly string[];
  readonly parsed: readonly (readonly string[])[];
  readonly existingRecords: ReadonlyMap<string, WealthImportRecord>;
  readonly parseRecord: (headers: readonly string[], values: readonly string[], rowIndex: number) => WealthImportRecord;
}

export function recordIdentity(record: WealthImportRecord, tools: RecordIdentityTools): string {
  if (record.recordType === 'account') return `account:${record.account.id}`;
  if (record.recordType === 'instrument') return `instrument:${record.instrument.id}`;
  if (record.recordType === 'event') return `event:${record.event.sourceId}`;
  if (record.recordType === 'mode_transition') return `mode_transition:${record.transition.accountId}:${record.transition.effectiveDate}`;
  const valuation = record.valuation;
  const key = valuation.instrument ? tools.instrumentKey(valuation.instrument) : tools.accountValueKey;
  return `valuation:${valuation.accountId}:${key}:${valuation.asOf}`;
}

export function recordId(record: WealthImportRecord): string {
  if (record.recordType === 'account') return record.account.id;
  if (record.recordType === 'instrument') return record.instrument.id;
  if (record.recordType === 'event') return record.event.id;
  if (record.recordType === 'mode_transition') return record.transition.id;
  return record.valuation.id;
}

export function recordSignature(record: WealthImportRecord, tools: RecordIdentityTools): string {
  if (record.recordType === 'account') return tools.stable({ ...record.account, currency: record.account.currency ?? null });
  if (record.recordType === 'instrument') return tools.stable(record.instrument);
  if (record.recordType === 'event') return tools.canonicalEventFingerprint(record.event);
  if (record.recordType === 'mode_transition') return tools.stable(record.transition);
  return tools.stable(record.valuation);
}

export function existingAccountRecord(account: WealthAccount & Record<string, unknown>): WealthImportRecord {
  return {
    recordType: 'account',
    account: {
      id: account.id,
      name: account.name,
      kind: account.kind,
      mode: account.mode,
      currency: typeof account.currency === 'string' ? account.currency : null,
      linkedBankAccountId: typeof account.linkedBankAccountId === 'string' ? account.linkedBankAccountId : null,
      amountMinor: typeof account.amountMinor === 'number' ? account.amountMinor : null,
      active: account.active !== false,
    },
  };
}

export function existingInstrumentRecord(instrument: CanonicalInstrument & Record<string, unknown>): WealthImportRecord {
  return { recordType: 'instrument', instrument: { id: String(instrument.id), exchange: instrument.exchange, ticker: instrument.ticker, type: instrument.type, currency: instrument.currency } };
}

export function existingValuationRecord(valuation: HoldingValuation & { id: string; instrumentKey?: string }): WealthImportRecord {
  return { recordType: 'valuation', valuation: { id: valuation.id, accountId: valuation.accountId, instrument: valuation.instrument.exchange ? valuation.instrument : null, asOf: valuation.asOf, priceMinor: valuation.priceMinor, source: valuation.source, provider: valuation.provider ?? null } };
}

export function existingModeTransitionRecord(transition: import('./wealth-import-types').ImportModeTransition): WealthImportRecord {
  return { recordType: 'mode_transition', transition };
}

export function recordMap(records: readonly WealthImportRecord[], tools: RecordIdentityTools): Map<string, WealthImportRecord> {
  return new Map(records.map((record) => [recordIdentity(record, tools), record]));
}

export function importRecordEvent(record: WealthImportRecord): WealthEvent | null {
  return record.recordType === 'event' ? record.event : null;
}

export function importRecordAccount(record: WealthImportRecord): WealthAccount | null {
  if (record.recordType !== 'account') return null;
  const { currency, ...account } = record.account;
  return currency ? { ...account, currency } : account;
}

export function importRecordValuation(record: WealthImportRecord) {
  return record.recordType === 'valuation' ? record.valuation : null;
}

export function importRecordTransition(record: WealthImportRecord) {
  return record.recordType === 'mode_transition' ? record.transition : null;
}

export function importRecordInstrument(record: WealthImportRecord) {
  return record.recordType === 'instrument' ? record.instrument : null;
}

export function previewRow(row: CsvPreviewRow) {
  const record = row.record;
  return { rowId: row.rowId, rowIndex: row.rowIndex, recordType: row.recordType, record, event: record?.recordType === 'event' ? record.event : null, error: row.error, duplicateOf: row.duplicateOf };
}

export function orderImportRecords(records: readonly WealthImportRecord[], startingSequence: number): WealthImportRecord[] {
  let sequence = startingSequence;
  const ordered = records.map((record, index) => ({ record, index })).sort((left, right) => importRecordRank(left.record) - importRecordRank(right.record) || transitionOrder(left.record, right.record) || left.index - right.index);
  return ordered.map(({ record }) => {
    const event = importRecordEvent(record);
    if (event) return { recordType: 'event', event: { ...event, sequence: sequence++ } as WealthEvent };
    if (record.recordType === 'mode_transition') sequence += transitionOpeningEventCount(record.transition);
    return record;
  });
}

function transitionOrder(left: WealthImportRecord, right: WealthImportRecord): number {
  if (left.recordType !== 'mode_transition' || right.recordType !== 'mode_transition') return 0;
  return left.transition.accountId.localeCompare(right.transition.accountId) || left.transition.effectiveDate.localeCompare(right.transition.effectiveDate);
}

function importRecordRank(record: WealthImportRecord): number {
  if (record.recordType === 'account') return 0;
  if (record.recordType === 'instrument') return 1;
  if (record.recordType === 'mode_transition') return 2;
  if (record.recordType === 'event') return 3;
  return 4;
}

export function rowForRecord(context: PreviewRowContext): CsvPreviewRow {
  return { rowId: context.rowId, rowIndex: context.rowIndex, recordType: context.record.recordType, record: context.record, event: importRecordEvent(context.record), error: context.error ?? null, duplicateOf: context.duplicateOf ?? null };
}

export function classifyPreviewRecord(context: PreviewClassificationContext, tools: RecordIdentityTools): { readonly row: CsvPreviewRow; readonly candidate: WealthImportRecord | null } {
  const key = recordIdentity(context.record, tools);
  const prior = context.seen.get(key);
  if (prior) return duplicateRow(context, prior, tools);
  const stored = context.existingRecords.get(key);
  if (stored) return existingRow(context, stored, tools);
  const row = rowForRecord(context);
  (context.seen as Map<string, CsvPreviewRow>).set(key, row);
  return { row, candidate: context.record };
}

function duplicateRow(context: PreviewClassificationContext, prior: CsvPreviewRow, tools: RecordIdentityTools) {
  const duplicateOf = prior.record && recordSignature(prior.record, tools) === recordSignature(context.record, tools) ? recordId(prior.record) : null;
  return { row: rowForRecord({ ...context, error: duplicateOf ? null : 'This file contains conflicting records for the same identity.', duplicateOf }), candidate: null };
}

function existingRow(context: PreviewClassificationContext, stored: WealthImportRecord, tools: RecordIdentityTools) {
  const duplicateOf = recordSignature(stored, tools) === recordSignature(context.record, tools) ? recordId(stored) : null;
  return { row: rowForRecord({ ...context, error: duplicateOf ? null : 'This record conflicts with an existing wealth record.', duplicateOf }), candidate: null };
}

function parsePreviewRow(context: PreviewCollectionContext, index: number, seen: Map<string, CsvPreviewRow>, tools: RecordIdentityTools): { readonly row: CsvPreviewRow; readonly candidate: WealthImportRecord | null } {
  const rowIndex = index - 1;
  try {
    const record = context.parseRecord(context.headers, context.parsed[index], rowIndex);
    return classifyPreviewRecord({ rowId: `row-${rowIndex + 1}`, rowIndex, record, seen, existingRecords: context.existingRecords }, tools);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid CSV row.';
    return { row: { rowId: `row-${rowIndex + 1}`, rowIndex, recordType: null, record: null, event: null, error: message, duplicateOf: null }, candidate: null };
  }
}

export function collectPreviewRows(context: PreviewCollectionContext, tools: RecordIdentityTools): { readonly rows: CsvPreviewRow[]; readonly candidates: WealthImportRecord[] } {
  const seen = new Map<string, CsvPreviewRow>();
  const rows: CsvPreviewRow[] = [];
  const candidates: WealthImportRecord[] = [];
  for (let index = 1; index < context.parsed.length; index += 1) {
    const classified = parsePreviewRow(context, index, seen, tools);
    rows.push(classified.row);
    if (classified.candidate) candidates.push(classified.candidate);
  }
  return { rows, candidates };
}
