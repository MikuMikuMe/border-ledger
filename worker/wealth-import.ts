import { initialAccountMode } from './wealth-import-transitions';
import { canonicalEventFingerprint, instrumentKey } from '../src/domain/wealth';
import type { D1Database } from './db-types';
import { assertFinancialAuthority, financialAuthorityPredicate, type FinancialContext } from './financial-authority';
import {
  assertBankLinkAvailable,
  bounded,
  currency,
  currentRevision,
  currentEventSequence,
  date,
  digest,
  eventAccountFields,
  mixedTransferMode,
  normalizeEvent,
  parseJson,
  randomId,
  readAccounts,
  readInstruments,
  readStoredEvents,
  readStoredValuations,
  runMutation,
  stable,
  validateExpected,
  WealthStoreError,
} from './wealth-store';
import { applyCsvMapping, csvRows, importRecordFromCsv } from './wealth-import-csv';
import { importCommitStatements, importedEventCount } from './wealth-import-commit';
import { CANONICAL_CSV_HEADERS, wealthCsvDocument, WEALTH_CSV_TEMPLATE } from './wealth-import-export';
import {
  collectPreviewRows,
  existingAccountRecord,
  existingInstrumentRecord,
  existingValuationRecord,
  orderImportRecords,
  recordMap,
  type RecordIdentityTools,
} from './wealth-import-records';
import { readWealthPreview, previewStatements } from './wealth-import-preview';
import { validateImportPortfolio } from './wealth-import-validation';
import { readImportModeTransitions } from './wealth-import-transitions';
import { WEALTH_ACCOUNT_VALUE_KEY } from './wealth-import-types';
import type { CsvMappingMetadata, CsvParserTools, CsvPreviewRow, ImportCommitServices, ImportValidationServices, ImportReadRow, WealthImportRecord } from './wealth-import-types';

const MAX_CSV_BYTES = 2 * 1024 * 1024;
const MAX_IMPORT_ROWS = 10_000;

const parserTools: CsvParserTools = {
  bounded,
  currency,
  date,
  normalizeEvent,
  invalidCsv: (message) => new WealthStoreError('invalid_csv', message),
};

const recordTools: RecordIdentityTools = {
  accountValueKey: WEALTH_ACCOUNT_VALUE_KEY,
  instrumentKey,
  stable,
  canonicalEventFingerprint,
};

const validationServices: ImportValidationServices = {
  readAccounts,
  readStoredEvents,
  readStoredValuations,
  readModeTransitions: (db, context, accounts = []) => readImportModeTransitions(db, context, accounts),
  assertBankLinkAvailable,
  mixedTransferMode,
  isBankLinkConflict: (error) => error instanceof WealthStoreError && error.code === 'bank_link_conflict',
};

const commitServices: ImportCommitServices = {
  accountValueKey: WEALTH_ACCOUNT_VALUE_KEY,
  instrumentKey,
  eventAccountFields,
};

type StoredPreviewRow = ImportReadRow;

export async function createWealthImportPreview(db: D1Database, context: FinancialContext, input: { csv: string; mapping?: unknown; operationId?: string }) {
  await assertFinancialAuthority(db, context, 'wealth:write');
  assertCsvSize(input.csv);
  const operationId = input.operationId ?? randomId('preview-operation');
  const parsed = parseImportCsv(input.csv, input.mapping);
  const csvHash = await digest({ csv: input.csv, mapping: parsed.metadata.mapping });
  const prior = await existingPreview(db, context, operationId, csvHash);
  if (prior) return readWealthPreview(db, context, prior, { currentRevision, parseJson });

  const existingRecords = await existingRecordMap(db, context);
  const collection = collectPreviewRows({
    headers: parsed.parsed[0],
    parsed: parsed.parsed,
    existingRecords,
    parseRecord: (headers, values, rowIndex) => importRecordFromCsv(headers, values, rowIndex, parserTools),
  }, recordTools);
  const validationErrors = await previewValidationErrors(db, context, collection.candidates);
  const rows = applyValidationErrors(collection.rows, validationErrors);
  const previewId = randomId('wealth-preview');
  const revision = await currentRevision(db, context);
  return persistImportPreview(db, context, { previewId, operationId, csvHash, mapping: parsed.metadata, rows, validationErrors, revision });
}

interface ParsedImportCsv {
  readonly parsed: string[][];
  readonly metadata: CsvMappingMetadata;
}

function parseImportCsv(csv: string, rawMapping: unknown): ParsedImportCsv {
  const parsed = csvRows(csv, parserTools, { allowCustomHeaders: true });
  if (parsed.length - 1 > MAX_IMPORT_ROWS) throw new WealthStoreError('invalid_csv', 'The CSV has too many rows.');
  return applyCsvMapping(parsed, rawMapping, parserTools, { allowUnmapped: isEmptyMapping(rawMapping) });
}

function isEmptyMapping(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
}

async function previewValidationErrors(db: D1Database, context: FinancialContext, candidates: readonly WealthImportRecord[]): Promise<string[]> {
  return candidates.length ? validateImportPortfolio(db, context, candidates, validationServices) : [];
}

interface PreviewPersistenceInput {
  readonly previewId: string;
  readonly operationId: string;
  readonly csvHash: string;
  readonly mapping: CsvMappingMetadata;
  readonly rows: readonly CsvPreviewRow[];
  readonly validationErrors: readonly string[];
  readonly revision: number;
}

async function persistImportPreview(db: D1Database, context: FinancialContext, input: PreviewPersistenceInput) {
  const guard = financialAuthorityPredicate(context, 'wealth:write');
  const statements = previewStatements({
    db,
    context,
    previewId: input.previewId,
    operationId: input.operationId,
    csvHash: input.csvHash,
    mappingJson: JSON.stringify({ ...input.mapping, validationErrors: input.validationErrors }),
    rows: input.rows,
    revision: input.revision,
    guard,
  });
  let result: readonly { meta?: { changes?: number } }[];
  try {
    result = await db.batch(statements);
  } catch (error) {
    const existing = await existingPreview(db, context, input.operationId, input.csvHash);
    if (!existing) throw error;
    return readWealthPreview(db, context, existing, { currentRevision, parseJson });
  }
  if (Number(result[0]?.meta?.changes ?? 0) < 1) throw new WealthStoreError('forbidden', 'The wealth authority is no longer valid.', 403);
  return {
    previewId: input.previewId,
    revision: input.revision,
    rows: input.rows,
    sourceHeaders: input.mapping.sourceHeaders,
    canonicalHeaders: input.mapping.canonicalHeaders,
    mapping: input.mapping.mapping,
    errors: [...input.rows.filter((row) => row.error), ...input.validationErrors.map((error) => ({ rowId: '__portfolio__', rowIndex: -1, error }))],
    duplicates: input.rows.filter((row) => row.duplicateOf),
    validationErrors: input.validationErrors,
  };
}

function assertCsvSize(csv: unknown): asserts csv is string {
  if (typeof csv !== 'string' || new TextEncoder().encode(csv).byteLength > MAX_CSV_BYTES) throw new WealthStoreError('invalid_csv', 'The CSV is missing or too large.');
}

async function existingPreview(db: D1Database, context: FinancialContext, operationId: string, csvHash: string): Promise<string | null> {
  const existing = await db.prepare('SELECT id,csv_sha256 FROM wealth_import_previews WHERE ledger_id=? AND operation_id=?').bind(context.ledgerId, operationId).first<{ id: string; csv_sha256: string }>();
  if (!existing) return null;
  if (existing.csv_sha256 !== csvHash) throw new WealthStoreError('idempotency_conflict', 'The import operation was already used for different CSV content.', 409);
  return existing.id;
}

async function existingRecordMap(db: D1Database, context: FinancialContext) {
  const [accounts, instruments, valuations, events] = await Promise.all([readAccounts(db, context), readInstruments(db, context), readStoredValuations(db, context), readStoredEvents(db, context)]);
  const transitions = await readImportModeTransitions(db, context, accounts);
  return recordMap([
    ...accounts.map(account => existingAccountRecord({ ...account, mode: initialAccountMode(account, transitions) })),
    ...instruments.map(existingInstrumentRecord),
    ...valuations.map(existingValuationRecord),
    ...transitions.map((transition) => ({ recordType: 'mode_transition' as const, transition })),
    ...events.map((event) => ({ recordType: 'event' as const, event })),
  ], recordTools);
}

function applyValidationErrors(rows: readonly CsvPreviewRow[], validationErrors: readonly string[]): CsvPreviewRow[] {
  if (!validationErrors.length) return [...rows];
  const globalError = validationErrors.find((error) => !rowValidationSubject(error));
  return rows.map((row) => {
    if (row.error || row.duplicateOf) return row;
    const specific = validationErrors.find((error) => rowValidationSubject(error, row));
    const error = specific ?? globalError;
    return error ? { ...row, error } : row;
  });
}

function rowValidationSubject(error: string, row?: CsvPreviewRow): boolean {
  const record = row?.record;
  if (!record) return false;
  if (record.recordType === 'event') return error.includes(`Event ${record.event.sourceId}`);
  if (record.recordType === 'valuation') return error.includes(`Valuation ${record.valuation.id}`);
  if (record.recordType === 'mode_transition') return error.includes(`Mode transition ${record.transition.id}`);
  if (record.recordType === 'account') return error.includes(`Account ${record.account.id}`);
  if (record.recordType === 'instrument') return error.includes(`Instrument ${record.instrument.id}`);
  return false;
}

async function commitEmptyPreview(db: D1Database, context: FinancialContext, previewId: string, input: { expectedRevision: number; rowIds?: readonly string[]; operationId?: string }): Promise<{ previewId: string; committed: number; revision: number }> {
  const revision = input.expectedRevision + 1;
  const operationId = input.operationId ?? 'import-commit-' + previewId;
  const response = { previewId, committed: 0, revision };
  const rowIds = input.rowIds;
  const rowPredicate = rowIds ? ` AND row_id IN (${rowIds.map(() => '?').join(',') || 'NULL'})` : '';
  return runMutation(db, context, {
    operationId,
    operationKind: 'import.commit',
    expectedRevision: input.expectedRevision,
    payloadHash: await digest({ previewId, rowIds: input.rowIds ?? null }),
    response,
    statements: (guard) => {
      const statements = [db.prepare(`UPDATE wealth_import_rows SET state='committed' WHERE ledger_id=? AND preview_id=? AND state IN ('valid','duplicate')${rowPredicate} AND ${guard.sql}`)
        .bind(context.ledgerId, previewId, ...(rowIds ?? []), ...guard.bindings)];
      statements.push(db.prepare(`UPDATE wealth_import_previews SET state=CASE WHEN EXISTS(
          SELECT 1 FROM wealth_import_rows WHERE ledger_id=? AND preview_id=? AND state IN ('valid','error')
        ) THEN 'preview' ELSE 'committed' END,revision=? WHERE ledger_id=? AND id=? AND state='preview' AND ${guard.sql}`)
        .bind(context.ledgerId, previewId, revision, context.ledgerId, previewId, ...guard.bindings));
      return statements;
    },
  });
}

export async function commitWealthImport(db: D1Database, context: FinancialContext, previewId: string, input: { expectedRevision: number; rowIds?: readonly string[]; operationId?: string }) {
  await assertFinancialAuthority(db, context, 'wealth:write');
  const replay = await replayedImportResult(db, context, previewId);
  if (replay) return replay;
  await validateExpected(db, context, input.expectedRevision);
  const allRows = await readImportRows(db, context, previewId);
  const selection = selectImportRows(allRows, input.rowIds);
  assertNoImportErrors(allRows, selection.selected);
  const validationErrors = await validateImportPortfolio(db, context, selection.records, validationServices);
  if (validationErrors.length) throw new WealthStoreError('invalid_csv', validationErrors[0]);
  if (selection.records.length === 0) return commitEmptyPreview(db, context, previewId, input);
  return runImportCommit({ db, context, previewId, input, selection });
}

async function replayedImportResult(db: D1Database, context: FinancialContext, previewId: string): Promise<{ previewId: string; committed: number; revision: number; replayed: true } | null> {
  const preview = await db.prepare('SELECT id,state FROM wealth_import_previews WHERE ledger_id=? AND id=?').bind(context.ledgerId, previewId).first<{ id: string; state: string }>();
  if (!preview) throw new WealthStoreError('not_found', 'The wealth import preview was not found.', 404);
  if (preview.state === 'committed') return { previewId, committed: 0, revision: await currentRevision(db, context), replayed: true };
  if (preview.state !== 'preview') throw new WealthStoreError('invalid_request', 'The wealth import preview is no longer available.');
  return null;
}

interface ImportSelection {
  readonly selected: ReadonlySet<string> | null;
  readonly rows: readonly StoredPreviewRow[];
  readonly records: readonly WealthImportRecord[];
}

function selectImportRows(rows: readonly StoredPreviewRow[], rowIds?: readonly string[]): ImportSelection {
  const selected = rowIds ? new Set(rowIds) : null;
  if (selected) {
    const known = new Set(rows.map((row) => row.row_id));
    for (const rowId of selected) if (!known.has(rowId)) throw new WealthStoreError('invalid_request', 'The import row selection is not valid.');
  }
  const validRows = rows.filter((row) => row.state === 'valid' && (!selected || selected.has(row.row_id)));
  const records = validRows.map((row) => parseJson<WealthImportRecord>(row.payload_json, 'import row'));
  return { selected, rows, records };
}

interface ImportCommitRequest {
  readonly db: D1Database;
  readonly context: FinancialContext;
  readonly previewId: string;
  readonly input: { expectedRevision: number; rowIds?: readonly string[]; operationId?: string };
  readonly selection: ImportSelection;
}

async function runImportCommit(request: ImportCommitRequest) {
  const { db, context, previewId, input, selection } = request;
  const revision = input.expectedRevision + 1;
  const eventSequence = await currentEventSequence(db, context);
  const orderedRecords = orderImportRecords(selection.records, eventSequence + 1);
  const operationId = input.operationId ?? 'import-commit-' + previewId;
  const response = { previewId, committed: selection.records.length, revision };
  return runMutation(db, context, {
    operationId,
    operationKind: 'import.commit',
    expectedRevision: input.expectedRevision,
    eventCount: importedEventCount(orderedRecords),
    payloadHash: await digest({ previewId, rowIds: input.rowIds ?? null }),
    response,
    statements: (guard) => importCommitStatements({ db, context, revision, guard, services: commitServices, previewId, selected: selection.selected, eventSequence: eventSequence + 1 }, orderedRecords, selection.rows),
  });
}

async function readImportRows(db: D1Database, context: FinancialContext, previewId: string): Promise<StoredPreviewRow[]> {
  const rows = await db.prepare('SELECT row_id,row_index,payload_json,error_json,duplicate_of,state FROM wealth_import_rows WHERE ledger_id=? AND preview_id=? ORDER BY row_index').bind(context.ledgerId, previewId).all<StoredPreviewRow>();
  return rows.results;
}

function assertNoImportErrors(rows: readonly StoredPreviewRow[], selected: ReadonlySet<string> | null): void {
  const invalid = rows.find((row) => row.state === 'error' && (!selected || selected.has(row.row_id)));
  if (!invalid) return;
  const message = invalid.error_json ? parseJson<{ message: string }>(invalid.error_json, 'import error').message : 'The import preview contains validation errors.';
  throw new WealthStoreError('invalid_csv', message);
}

export async function wealthExportCsv(db: D1Database, context: FinancialContext): Promise<string> {
  const [accounts, instruments, valuations, events] = await Promise.all([readAccounts(db, context), readInstruments(db, context), readStoredValuations(db, context), readStoredEvents(db, context)]);
  const transitions = await readImportModeTransitions(db, context, accounts);
  return wealthCsvDocument(accounts, instruments, valuations, events, transitions);
}
export { CANONICAL_CSV_HEADERS, WEALTH_CSV_TEMPLATE };
