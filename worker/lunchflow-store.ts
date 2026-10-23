import type { D1Database, D1Result, D1Statement } from './db-types';
import { LunchFlowError, type MappedLunchFlowTransaction } from './lunchflow';

export interface LunchFlowMapping {
  providerAccountId: string;
  accountId: string | null;
  ledgerId: 'personal';
  name: string;
  institution: string;
  currency: string | null;
  kind: 'chequing' | 'savings' | 'credit' | null;
  enabled: boolean;
  revision: number;
  lastSyncedAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

export interface LunchFlowSelectionRecord {
  providerAccountId: string;
  accountId: string;
  name: string;
  institution: string;
  currency: string;
  kind: 'chequing' | 'savings' | 'credit';
}

export interface LunchFlowRevision {
  providerAccountId: string;
  revision: number;
}

export interface LunchFlowOperationRecord {
  response: Record<string, unknown>;
  requestDigest: string | null;
  revisions: LunchFlowRevision[];
  pending?: boolean;
}

export interface LunchFlowOperationIdentity {
  ownerSubjectHash: string;
  operationKind: string;
  idempotencyKey: string;
}

export interface LunchFlowOperationReceipt {
  response: Record<string, unknown>;
  requestDigest?: string;
  revisions?: readonly LunchFlowRevision[];
}

export interface LunchFlowSelectionOperation extends LunchFlowOperationIdentity {
  requestDigest: string;
  response: Record<string, unknown>;
  selection: readonly LunchFlowSelectionRecord[];
}

export interface LunchFlowSelectionPublication {
  revisions: LunchFlowRevision[];
  operation: LunchFlowOperationRecord | null;
}

export class LunchFlowOperationConflictError extends LunchFlowError {
  constructor() {
    super('idempotency_conflict', 'The idempotency key was already used for a different Lunch Flow request.', 409, false);
  }
}

interface LunchFlowMappingRow {
  provider_account_id: string;
  account_id: string | null;
  ledger_id: string;
  name: string;
  institution: string;
  currency: string | null;
  kind: string | null;
  enabled: number;
  revision: number;
  last_synced_at: string | null;
  last_error: string | null;
  updated_at: string;
}

const LEDGER_ID = 'personal';
const MAX_D1_SNAPSHOT_BYTES = 2_000_000;

function mapKind(value: string | null): LunchFlowMapping['kind'] {
  return value === 'chequing' || value === 'savings' || value === 'credit' ? value : null;
}

function mapRow(row: LunchFlowMappingRow): LunchFlowMapping {
  return {
    providerAccountId: row.provider_account_id,
    accountId: row.account_id,
    ledgerId: LEDGER_ID,
    name: row.name,
    institution: row.institution,
    currency: row.currency,
    kind: mapKind(row.kind),
    enabled: Number(row.enabled) === 1,
    revision: Number(row.revision),
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}

export async function readLunchFlowMappings(db: D1Database, enabledOnly = false) {
  const result = await db.prepare(`SELECT provider_account_id, account_id, ledger_id, name, institution, currency, kind,
      enabled, revision, last_synced_at, last_error, updated_at
    FROM lunchflow_accounts
    WHERE ledger_id = 'personal'${enabledOnly ? ' AND enabled = 1' : ''}
    ORDER BY provider_account_id`).all<LunchFlowMappingRow>();
  return result.results.map(mapRow);
}

export async function readLunchFlowMapping(db: D1Database, providerAccountId: string) {
  const result = await db.prepare(`SELECT provider_account_id, account_id, ledger_id, name, institution, currency, kind,
      enabled, revision, last_synced_at, last_error, updated_at
    FROM lunchflow_accounts WHERE ledger_id = 'personal' AND provider_account_id = ? LIMIT 1`).bind(providerAccountId).first<LunchFlowMappingRow>();
  return result ? mapRow(result) : null;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function lunchFlowLedgerAccountId(providerAccountId: string) {
  return `lunchflow-${await sha256(providerAccountId)}`;
}

function operationResponseJson(response: Record<string, unknown>, requestDigest?: string, revisions: readonly LunchFlowRevision[] = []) {
  return JSON.stringify({ response, requestDigest: requestDigest ?? null, revisions });
}

async function operationId(identity: LunchFlowOperationIdentity) {
  return `lunchflow-operation-${await sha256(`${identity.ownerSubjectHash}\u0000${identity.operationKind}\u0000${identity.idempotencyKey}`)}`;
}

function operationRevisions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((revision): revision is LunchFlowRevision => (
    Boolean(revision)
    && typeof revision === 'object'
    && typeof (revision as Record<string, unknown>).providerAccountId === 'string'
    && Number.isSafeInteger((revision as Record<string, unknown>).revision)
    && ((revision as Record<string, unknown>).revision as number) >= 1
  ));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function checkOperationDigest(envelope: Record<string, unknown>, requestDigest?: string) {
  if (requestDigest !== undefined && envelope.requestDigest !== requestDigest) throw new LunchFlowOperationConflictError();
}

function parsePendingOperation(envelope: Record<string, unknown>, requestDigest?: string): LunchFlowOperationRecord {
  checkOperationDigest(envelope, requestDigest);
  return {
    response: {},
    requestDigest: typeof envelope.requestDigest === 'string' ? envelope.requestDigest : null,
    revisions: [],
    pending: true,
  };
}

function parseFinalOperation(envelope: Record<string, unknown>, requestDigest?: string): LunchFlowOperationRecord | null {
  if (!Object.prototype.hasOwnProperty.call(envelope, 'response') || !Object.prototype.hasOwnProperty.call(envelope, 'requestDigest')) {
    return { response: envelope, requestDigest: null, revisions: [] };
  }
  checkOperationDigest(envelope, requestDigest);
  if (!isRecord(envelope.response)) return null;
  return {
    response: envelope.response,
    requestDigest: typeof envelope.requestDigest === 'string' ? envelope.requestDigest : null,
    revisions: operationRevisions(envelope.revisions),
  };
}

function parseOperationRecord(parsed: unknown, requestDigest?: string): LunchFlowOperationRecord | null {
  if (!isRecord(parsed)) return null;
  return parsed.state === 'pending' ? parsePendingOperation(parsed, requestDigest) : parseFinalOperation(parsed, requestDigest);
}

interface SelectionSqlContext {
  selectionJson: string;
  updatedAt: string;
  operationGate: string;
  operationGateValues: unknown[];
}

function selectionSqlContext(selection: readonly LunchFlowSelectionRecord[], operation: LunchFlowSelectionOperation | undefined, operationIdValue: string | null): SelectionSqlContext {
  const selectionJson = JSON.stringify(selection);
  return {
    selectionJson,
    updatedAt: new Date().toISOString(),
    operationGate: operationIdValue
      ? `EXISTS (SELECT 1 FROM lunchflow_operations operation_gate
          WHERE operation_gate.id = ? AND operation_gate.ledger_id = 'personal'
            AND json_extract(operation_gate.response_json, '$.state') = 'pending'
            AND json_extract(operation_gate.response_json, '$.requestDigest') = ?)`
      : '1',
    operationGateValues: operation ? [operationIdValue, operation.requestDigest] : [],
  };
}

function selectionClaimStatement(db: D1Database, operation: LunchFlowSelectionOperation, operationIdValue: string, selectionJson: string) {
  return db.prepare(`INSERT INTO lunchflow_operations
    (id, ledger_id, owner_subject_hash, operation_kind, idempotency_key, response_json)
    VALUES (?, 'personal', ?, ?, ?, json_object('state', 'pending', 'requestDigest', ?, 'selection', json(?)))
    ON CONFLICT(ledger_id, owner_subject_hash, operation_kind, idempotency_key) DO NOTHING`)
    .bind(operationIdValue, operation.ownerSubjectHash, operation.operationKind, operation.idempotencyKey, operation.requestDigest, selectionJson);
}

function selectionReplacementStatements(db: D1Database, context: SelectionSqlContext) {
  const { selectionJson, updatedAt, operationGate, operationGateValues } = context;
  return [
    db.prepare(`UPDATE lunchflow_accounts
      SET enabled = 0, revision = revision + 1, updated_at = ?
      WHERE ledger_id = 'personal' AND enabled = 1
        AND NOT EXISTS (SELECT 1 FROM json_each(?) AS selected
          WHERE json_extract(selected.value, '$.providerAccountId') = lunchflow_accounts.provider_account_id)
        AND ${operationGate}`).bind(updatedAt, selectionJson, ...operationGateValues),
    db.prepare(`INSERT INTO accounts (id, name, institution, currency, currency_mode, kind, status, last_synced_at)
      SELECT json_extract(selected.value, '$.accountId'), json_extract(selected.value, '$.name'),
        json_extract(selected.value, '$.institution'), json_extract(selected.value, '$.currency'),
        'single', json_extract(selected.value, '$.kind'), 'connected', NULL
      FROM json_each(?) AS selected
      WHERE ${operationGate}
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        institution = excluded.institution,
        kind = excluded.kind,
        status = excluded.status`).bind(selectionJson, ...operationGateValues),
    db.prepare(`UPDATE accounts
      SET currency = (SELECT json_extract(selected.value, '$.currency')
        FROM json_each(?) AS selected WHERE json_extract(selected.value, '$.accountId') = accounts.id)
      WHERE EXISTS (SELECT 1 FROM json_each(?) AS selected
        WHERE json_extract(selected.value, '$.accountId') = accounts.id
          AND json_extract(selected.value, '$.currency') <> accounts.currency)
        AND ${operationGate}`).bind(selectionJson, selectionJson, ...operationGateValues),
    db.prepare(`INSERT INTO lunchflow_accounts
      (provider_account_id, account_id, ledger_id, name, institution, currency, kind, enabled, revision, last_error, updated_at)
      SELECT json_extract(selected.value, '$.providerAccountId'), json_extract(selected.value, '$.accountId'),
        'personal', json_extract(selected.value, '$.name'), json_extract(selected.value, '$.institution'),
        json_extract(selected.value, '$.currency'), json_extract(selected.value, '$.kind'), 1, 1, NULL, ?
      FROM json_each(?) AS selected
      WHERE ${operationGate}
      ON CONFLICT(provider_account_id) DO UPDATE SET
        account_id = excluded.account_id,
        ledger_id = excluded.ledger_id,
        name = excluded.name,
        institution = excluded.institution,
        currency = excluded.currency,
        kind = excluded.kind,
        enabled = 1,
        revision = lunchflow_accounts.revision + 1,
        last_error = NULL,
        updated_at = excluded.updated_at`).bind(updatedAt, selectionJson, ...operationGateValues),
  ];
}

function selectionReceiptStatement(
  db: D1Database,
  operation: LunchFlowSelectionOperation,
  operationIdValue: string,
  selectionJson: string,
) {
  return db.prepare(`UPDATE lunchflow_operations
    SET response_json = json_object(
      'response', json(?),
      'requestDigest', ?,
      'revisions', json(COALESCE((SELECT json_group_array(json_object('providerAccountId', provider_account_id, 'revision', revision))
        FROM (SELECT provider_account_id, revision FROM lunchflow_accounts
          WHERE ledger_id = 'personal' AND provider_account_id IN
            (SELECT json_extract(selected.value, '$.providerAccountId') FROM json_each(?) AS selected)
          ORDER BY provider_account_id)), '[]')))
    WHERE id = ? AND ledger_id = 'personal'
      AND json_extract(response_json, '$.state') = 'pending'
      AND json_extract(response_json, '$.requestDigest') = ?`)
    .bind(JSON.stringify(operation.response), operation.requestDigest, selectionJson, operationIdValue, operation.requestDigest);
}

function selectionRevisionStatement(db: D1Database, selectionJson: string) {
  return db.prepare(`SELECT provider_account_id, revision FROM lunchflow_accounts
    WHERE ledger_id = 'personal'
      AND enabled = 1
      AND provider_account_id IN (SELECT json_extract(selected.value, '$.providerAccountId') FROM json_each(?) AS selected)
    ORDER BY provider_account_id`).bind(selectionJson);
}

function parseSelectionRevisions(value: unknown): LunchFlowRevision[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is Record<string, unknown> => (
    Boolean(row)
    && typeof row === 'object'
    && typeof (row as Record<string, unknown>).provider_account_id === 'string'
    && Number.isSafeInteger(Number((row as Record<string, unknown>).revision))
  )).map((row) => ({
    providerAccountId: String(row.provider_account_id),
    revision: Number(row.revision),
  }));
}

async function completeSelectionPublication(
  db: D1Database,
  selection: readonly LunchFlowSelectionRecord[],
  operation: LunchFlowSelectionOperation | undefined,
  batchResults: D1Result[],
): Promise<LunchFlowSelectionPublication> {
  if (operation) {
    const record = await readLunchFlowOperationRecord(db, operation, operation.requestDigest);
    if (record && !record.pending) return { revisions: record.revisions, operation: record };
    throw new LunchFlowError('operation_unavailable', 'The Lunch Flow selection could not be recorded.', 503, true);
  }
  const revisions = parseSelectionRevisions(batchResults[batchResults.length - 1]?.results);
  if (revisions.length === selection.length) return { revisions, operation: null };
  const fallback = await readLunchFlowMappings(db, true);
  return {
    revisions: fallback
      .filter((row) => selection.some((item) => item.providerAccountId === row.providerAccountId))
      .map(({ providerAccountId, revision }) => ({ providerAccountId, revision })),
    operation: null,
  };
}

export async function publishLunchFlowSelection(
  db: D1Database,
  selection: readonly LunchFlowSelectionRecord[],
  operation?: LunchFlowSelectionOperation,
) : Promise<LunchFlowSelectionPublication> {
  const operationIdValue = operation ? await operationId(operation) : null;
  const context = selectionSqlContext(selection, operation, operationIdValue);
  const statements: D1Statement[] = [];
  if (operation && operationIdValue) statements.push(selectionClaimStatement(db, operation, operationIdValue, context.selectionJson));
  statements.push(...selectionReplacementStatements(db, context));
  if (operation && operationIdValue) statements.push(selectionReceiptStatement(db, operation, operationIdValue, context.selectionJson));
  statements.push(selectionRevisionStatement(db, context.selectionJson));

  const batchResults = statements.length > 0 ? await db.batch(statements) : [];
  return completeSelectionPublication(db, selection, operation, batchResults);
}

export async function readLunchFlowOperationRecord(
  db: D1Database,
  identity: LunchFlowOperationIdentity,
  requestDigest?: string,
) {
  const row = await db.prepare(`SELECT response_json FROM lunchflow_operations
    WHERE ledger_id = 'personal' AND owner_subject_hash = ? AND operation_kind = ? AND idempotency_key = ? LIMIT 1`)
    .bind(identity.ownerSubjectHash, identity.operationKind, identity.idempotencyKey).first<{ response_json: string }>();
  if (!row) return null;
  try {
    return parseOperationRecord(JSON.parse(row.response_json) as unknown, requestDigest);
  } catch (error) {
    if (error instanceof LunchFlowOperationConflictError) throw error;
    return null;
  }
}

export async function rememberLunchFlowOperation(
  db: D1Database,
  identity: LunchFlowOperationIdentity,
  receipt: LunchFlowOperationReceipt,
) {
  const id = await operationId(identity);
  await db.prepare(`INSERT INTO lunchflow_operations
    (id, ledger_id, owner_subject_hash, operation_kind, idempotency_key, response_json)
    VALUES (?, 'personal', ?, ?, ?, ?)
    ON CONFLICT(ledger_id, owner_subject_hash, operation_kind, idempotency_key) DO NOTHING`)
    .bind(
      id,
      identity.ownerSubjectHash,
      identity.operationKind,
      identity.idempotencyKey,
      operationResponseJson(receipt.response, receipt.requestDigest, receipt.revisions),
    ).run();
  return (await readLunchFlowOperationRecord(db, identity, receipt.requestDigest))?.response ?? receipt.response;
}

export async function lunchFlowRequestDigest(value: unknown) {
  return sha256(JSON.stringify(value));
}

export async function recordLunchFlowError(db: D1Database, revision: LunchFlowRevision, message: string, updatedAt = new Date().toISOString()) {
  const bounded = message.trim().slice(0, 512) || 'Lunch Flow sync failed.';
  await db.prepare(`UPDATE lunchflow_accounts SET last_error = ?, updated_at = ?
    WHERE ledger_id = 'personal' AND provider_account_id = ? AND enabled = 1 AND revision = ?`)
    .bind(bounded, updatedAt, revision.providerAccountId, revision.revision).run();
}

function snapshotPayload(transactions: readonly MappedLunchFlowTransaction[]) {
  return JSON.stringify(transactions.map((transaction) => ({
    id: transaction.id,
    accountId: transaction.accountId,
    date: transaction.date,
    merchant: transaction.merchant,
    amountMinor: transaction.amountMinor,
    currency: transaction.currency,
    category: transaction.category,
    kind: transaction.kind,
    status: transaction.status,
    fingerprint: transaction.fingerprint,
    note: transaction.note ?? null,
    providerAccountId: transaction.providerAccountId,
    providerTransactionId: transaction.providerTransactionId,
    sourceIdentity: transaction.sourceIdentity,
    sourceRecordId: transaction.sourceRecordId,
    contentDigest: transaction.contentDigest,
  })));
}

interface SnapshotSqlContext {
  db: D1Database;
  accountId: string;
  providerAccountId: string;
  revision: number;
  payload: string;
  syncedAt: string;
  revisionFence: string;
}

function snapshotCurrencyStatements(context: SnapshotSqlContext) {
  const { db, accountId, providerAccountId, revision, payload, revisionFence } = context;
  return [
    db.prepare(`INSERT OR IGNORE INTO account_currencies (account_id, currency)
      SELECT ?, json_extract(incoming.value, '$.currency')
      FROM json_each(?) AS incoming
      WHERE ${revisionFence}`)
      .bind(accountId, payload, providerAccountId, accountId, revision),
    db.prepare(`UPDATE accounts SET currency_mode = 'multi'
      WHERE id = ?
        AND EXISTS (SELECT 1 FROM json_each(?) AS incoming
          WHERE json_extract(incoming.value, '$.currency') <> accounts.currency)
        AND ${revisionFence}`)
      .bind(accountId, payload, providerAccountId, accountId, revision),
  ];
}

function snapshotTransactionStatements(context: SnapshotSqlContext) {
  const { db, accountId, providerAccountId, revision, payload, revisionFence } = context;
  return [db.prepare(`INSERT INTO transactions
    (id, account_id, date, fx_lock_date, merchant, amount_minor, currency, category, kind, status, source,
     fingerprint, note, provider_transaction_id, provider_pending_transaction_id)
    SELECT json_extract(incoming.value, '$.id'), ?,
      json_extract(incoming.value, '$.date'), json_extract(incoming.value, '$.date'),
      json_extract(incoming.value, '$.merchant'), json_extract(incoming.value, '$.amountMinor'),
      json_extract(incoming.value, '$.currency'), json_extract(incoming.value, '$.category'),
      json_extract(incoming.value, '$.kind'), json_extract(incoming.value, '$.status'), 'lunchflow',
      json_extract(incoming.value, '$.fingerprint'), json_extract(incoming.value, '$.note'),
      json_extract(incoming.value, '$.providerTransactionId'), NULL
    FROM json_each(?) AS incoming
    WHERE ${revisionFence}
    ON CONFLICT(id) DO UPDATE SET
      account_id = excluded.account_id,
      date = excluded.date,
      merchant = excluded.merchant,
      amount_minor = excluded.amount_minor,
      currency = excluded.currency,
      category = excluded.category,
      kind = excluded.kind,
      status = excluded.status,
      source = 'lunchflow',
      fingerprint = excluded.fingerprint,
      note = excluded.note,
      provider_transaction_id = excluded.provider_transaction_id,
      provider_pending_transaction_id = NULL,
      updated_at = CURRENT_TIMESTAMP`)
    .bind(accountId, payload, providerAccountId, accountId, revision)];
}

function snapshotSourceStatements(context: SnapshotSqlContext) {
  const { db, accountId, providerAccountId, revision, payload, revisionFence } = context;
  return [db.prepare(`INSERT INTO transaction_source_records
    (id, ledger_id, source_kind, identity_key, transaction_id, account_id, provider_item_id, provider_account_id,
     provider_transaction_id, content_digest)
    SELECT json_extract(incoming.value, '$.sourceRecordId'), 'personal', 'lunchflow',
      json_extract(incoming.value, '$.sourceIdentity'), json_extract(incoming.value, '$.id'), ?, NULL,
      json_extract(incoming.value, '$.providerAccountId'), json_extract(incoming.value, '$.providerTransactionId'),
      json_extract(incoming.value, '$.contentDigest')
    FROM json_each(?) AS incoming
    WHERE ${revisionFence}
    ON CONFLICT(ledger_id, source_kind, identity_key) DO UPDATE SET
      transaction_id = excluded.transaction_id,
      account_id = excluded.account_id,
      provider_item_id = NULL,
      provider_account_id = excluded.provider_account_id,
      provider_transaction_id = excluded.provider_transaction_id,
      content_digest = excluded.content_digest`)
    .bind(accountId, payload, providerAccountId, accountId, revision)];
}

function snapshotCleanupStatements(context: SnapshotSqlContext) {
  const { db, accountId, providerAccountId, revision, payload, revisionFence } = context;
  return [db.prepare(`DELETE FROM transactions
    WHERE account_id = ? AND source = 'lunchflow' AND status = 'provisional'
      AND ${revisionFence}
      AND EXISTS (SELECT 1 FROM transaction_source_records source_row
        WHERE source_row.transaction_id = transactions.id AND source_row.source_kind = 'lunchflow'
          AND source_row.provider_account_id = ?
          AND NOT EXISTS (SELECT 1 FROM json_each(?) AS incoming
            WHERE json_extract(incoming.value, '$.providerTransactionId') = source_row.provider_transaction_id))`)
    .bind(accountId, providerAccountId, accountId, revision, providerAccountId, payload)];
}

function snapshotMetadataStatements(context: SnapshotSqlContext) {
  const { db, accountId, providerAccountId, revision, syncedAt } = context;
  return [
    db.prepare(`UPDATE lunchflow_accounts SET last_synced_at = ?, last_error = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE ledger_id = 'personal' AND provider_account_id = ? AND enabled = 1 AND revision = ?`)
      .bind(syncedAt, providerAccountId, revision),
    db.prepare(`UPDATE accounts SET last_synced_at = ?
      WHERE id = ? AND EXISTS (SELECT 1 FROM lunchflow_accounts fence
        WHERE fence.ledger_id = 'personal' AND fence.provider_account_id = ? AND fence.account_id = ?
          AND fence.enabled = 1 AND fence.revision = ?)`)
      .bind(syncedAt, accountId, providerAccountId, accountId, revision),
  ];
}

function snapshotStatements(context: SnapshotSqlContext) {
  return [
    ...snapshotCurrencyStatements(context),
    ...snapshotTransactionStatements(context),
    ...snapshotSourceStatements(context),
    ...snapshotCleanupStatements(context),
    ...snapshotMetadataStatements(context),
  ];
}

function isCurrentSnapshotMapping(mapping: LunchFlowMapping | null, revision: LunchFlowRevision): mapping is LunchFlowMapping & { accountId: string } {
  return Boolean(mapping?.enabled && mapping.revision === revision.revision && mapping.accountId);
}

export async function publishLunchFlowSnapshot(
  db: D1Database,
  revision: LunchFlowRevision,
  transactions: readonly MappedLunchFlowTransaction[],
  syncedAt: string,
) {
  const mapping = await readLunchFlowMapping(db, revision.providerAccountId);
  if (!isCurrentSnapshotMapping(mapping, revision)) return { stale: true, written: 0 };
  const payload = snapshotPayload(transactions);
  if (new TextEncoder().encode(payload).byteLength > MAX_D1_SNAPSHOT_BYTES) {
    throw new LunchFlowError('snapshot_too_large', 'Lunch Flow returned an oversized snapshot.', 502, true);
  }
  const statements = snapshotStatements({
    db,
    accountId: mapping.accountId,
    providerAccountId: revision.providerAccountId,
    revision: revision.revision,
    payload,
    syncedAt,
    revisionFence: `EXISTS (SELECT 1 FROM lunchflow_accounts fence
      WHERE fence.ledger_id = 'personal' AND fence.provider_account_id = ? AND fence.account_id = ?
        AND fence.enabled = 1 AND fence.revision = ?)`,
  });
  await db.batch(statements);
  return { stale: false, written: transactions.length };
}
