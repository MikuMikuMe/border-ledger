import type { D1Database, D1Statement } from './db-types';
import type { FinancialContext } from './financial-authority';
import type { ImportCommitServices, ImportReadRow, WealthImportRecord } from './wealth-import-types';
import { storedTransitionPayload, transitionOpeningEvents, transitionOpeningValuations, transitionOpeningEventCount } from './wealth-import-transitions';

export interface ImportSqlGuard {
  readonly sql: string;
  readonly bindings: readonly unknown[];
}

export interface ImportStatementContext {
  readonly db: D1Database;
  readonly context: FinancialContext;
  readonly revision: number;
  readonly guard: ImportSqlGuard;
  readonly services: ImportCommitServices;
  readonly eventSequence?: number;
}

type RecordWriter = (context: ImportStatementContext, record: WealthImportRecord) => D1Statement[];

function accountStatement(context: ImportStatementContext, record: Extract<WealthImportRecord, { recordType: 'account' }>): D1Statement[] {
  const account = record.account;
  return [context.db.prepare(`INSERT INTO wealth_accounts(ledger_id,id,name,kind,mode,currency,linked_bank_account_id,amount_minor,active,revision) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${context.guard.sql}`)
    .bind(context.context.ledgerId, account.id, account.name, account.kind, account.mode, account.currency, account.linkedBankAccountId, account.amountMinor, account.active ? 1 : 0, context.revision, ...context.guard.bindings)];
}

function instrumentStatement(context: ImportStatementContext, record: Extract<WealthImportRecord, { recordType: 'instrument' }>): D1Statement[] {
  const instrument = record.instrument;
  return [context.db.prepare(`INSERT INTO wealth_instruments(ledger_id,id,exchange,ticker,type,currency,revision) SELECT ?,?,?,?,?,?,? WHERE ${context.guard.sql}`)
    .bind(context.context.ledgerId, instrument.id, instrument.exchange, instrument.ticker, instrument.type, instrument.currency, context.revision, ...context.guard.bindings)];
}

function valuationStatement(context: ImportStatementContext, record: Extract<WealthImportRecord, { recordType: 'valuation' }>): D1Statement[] {
  const valuation = record.valuation;
  const key = valuation.instrument ? context.services.instrumentKey(valuation.instrument) : context.services.accountValueKey;
  return [context.db.prepare(`INSERT INTO wealth_valuations(ledger_id,id,account_id,instrument_key,as_of,price_minor,source,provider,payload_json,revision) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${context.guard.sql}`)
    .bind(context.context.ledgerId, valuation.id, valuation.accountId, key, valuation.asOf, valuation.priceMinor, valuation.source, valuation.provider, JSON.stringify(valuation), context.revision, ...context.guard.bindings)];
}

function eventStatement(context: ImportStatementContext, record: Extract<WealthImportRecord, { recordType: 'event' }>, sequence = record.event.sequence): D1Statement[] {
  const event = sequence === undefined ? record.event : { ...record.event, sequence };
  const fields = context.services.eventAccountFields(event);
  return [context.db.prepare(`INSERT INTO wealth_events(ledger_id,id,source_id,date,sequence,kind,account_id,from_account_id,to_account_id,linked_bank_source_id,payload_json) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${context.guard.sql}`)
    .bind(context.context.ledgerId, event.id, event.sourceId, event.date, event.sequence, event.kind, fields.accountId, fields.fromAccountId, fields.toAccountId, event.linkedBankSourceId ?? null, JSON.stringify(event), ...context.guard.bindings)];
}

function modeTransitionStatements(context: ImportStatementContext, record: Extract<WealthImportRecord, { recordType: 'mode_transition' }>, startingSequence: number): D1Statement[] {
  const transition = record.transition;
  const statements: D1Statement[] = [context.db.prepare(`UPDATE wealth_accounts SET mode=?,amount_minor=?,revision=?,updated_at=CURRENT_TIMESTAMP WHERE ledger_id=? AND id=? AND ${context.guard.sql}`)
    .bind(transition.toMode, transition.toMode === 'aggregate' ? transition.openingValueMinor : null, context.revision, context.context.ledgerId, transition.accountId, ...context.guard.bindings),
  context.db.prepare(`INSERT INTO wealth_account_mode_transitions(ledger_id,account_id,effective_date,from_mode,to_mode,revision,payload_json) SELECT ?,?,?,?,?,?,? WHERE ${context.guard.sql}`)
    .bind(context.context.ledgerId, transition.accountId, transition.effectiveDate, transition.fromMode, transition.toMode, context.revision, storedTransitionPayload(transition), ...context.guard.bindings)];
  for (const event of transitionOpeningEvents(transition, startingSequence)) {
    const fields = context.services.eventAccountFields(event);
    statements.push(context.db.prepare(`INSERT INTO wealth_events(ledger_id,id,source_id,date,sequence,kind,account_id,from_account_id,to_account_id,linked_bank_source_id,payload_json) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${context.guard.sql}`)
      .bind(context.context.ledgerId, event.id, event.sourceId, event.date, event.sequence, event.kind, fields.accountId, fields.fromAccountId, fields.toAccountId, event.linkedBankSourceId ?? null, JSON.stringify(event), ...context.guard.bindings));
  }
  for (const valuation of transitionOpeningValuations(transition)) {
    const key = valuation.instrument ? context.services.instrumentKey(valuation.instrument) : context.services.accountValueKey;
    statements.push(context.db.prepare(`INSERT INTO wealth_valuations(ledger_id,id,account_id,instrument_key,as_of,price_minor,source,provider,payload_json,revision) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${context.guard.sql}`)
      .bind(context.context.ledgerId, valuation.id, valuation.accountId, key, valuation.asOf, valuation.priceMinor, valuation.source, valuation.provider, JSON.stringify(valuation), context.revision, ...context.guard.bindings));
  }
  return statements;
}

const RECORD_WRITERS: Record<WealthImportRecord['recordType'], RecordWriter> = {
  account: (context, record) => accountStatement(context, record as Extract<WealthImportRecord, { recordType: 'account' }>),
  instrument: (context, record) => instrumentStatement(context, record as Extract<WealthImportRecord, { recordType: 'instrument' }>),
  valuation: (context, record) => valuationStatement(context, record as Extract<WealthImportRecord, { recordType: 'valuation' }>),
  event: (context, record) => eventStatement(context, record as Extract<WealthImportRecord, { recordType: 'event' }>),
  mode_transition: (context, record) => modeTransitionStatements(context, record as Extract<WealthImportRecord, { recordType: 'mode_transition' }>, context.eventSequence ?? 1),
};

export function importRecordStatements(context: ImportStatementContext, record: WealthImportRecord): D1Statement[] {
  return RECORD_WRITERS[record.recordType](context, record);
}

export interface ImportCommitContext extends ImportStatementContext {
  readonly previewId: string;
  readonly selected: ReadonlySet<string> | null;
}

export function importCommitStatements(context: ImportCommitContext, records: readonly WealthImportRecord[], rows: readonly Pick<ImportReadRow, 'row_id'>[]): D1Statement[] {
  const statements: D1Statement[] = [];
  let sequence = context.eventSequence ?? 1;
  for (const record of records) {
    if (record.recordType === 'mode_transition') {
      statements.push(...modeTransitionStatements(context, record, sequence));
      sequence += transitionOpeningEventCount(record.transition);
    } else if (record.recordType === 'event') {
      statements.push(...eventStatement(context, record, sequence++));
    } else {
      statements.push(...importRecordStatements(context, record));
    }
  }
  for (const row of rows) if (!context.selected || context.selected.has(row.row_id)) {
    statements.push(context.db.prepare(`UPDATE wealth_import_rows SET state='committed' WHERE ledger_id=? AND preview_id=? AND row_id=? AND state IN ('valid','duplicate') AND ${context.guard.sql}`)
      .bind(context.context.ledgerId, context.previewId, row.row_id, ...context.guard.bindings));
  }
  statements.push(context.db.prepare(`UPDATE wealth_import_previews SET state=CASE WHEN EXISTS(
      SELECT 1 FROM wealth_import_rows WHERE ledger_id=? AND preview_id=? AND state IN ('valid','error')
    ) THEN 'preview' ELSE 'committed' END,revision=? WHERE ledger_id=? AND id=? AND state='preview' AND ${context.guard.sql}`)
    .bind(context.context.ledgerId, context.previewId, context.revision, context.context.ledgerId, context.previewId, ...context.guard.bindings));
  return statements;
}

export function importedEventCount(records: readonly WealthImportRecord[]): number {
  return records.reduce((count, record) => count + (record.recordType === 'event' ? 1 : record.recordType === 'mode_transition' ? transitionOpeningEventCount(record.transition) : 0), 0);
}
