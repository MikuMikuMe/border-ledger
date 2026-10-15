import { afterEach, describe, expect, it } from 'vitest';
import { createD1Fixture, task18MigrationNames } from './helpers/d1';
import worker from '../worker/index';
import { createImportPreviewForOwner, commitImportForOwner, decideImportDuplicateForOwner } from '../worker/mobile-import';
import { createOpaqueCredential, hashSecret, type OwnerContext, type OwnerScope } from '../worker/mobile-auth';
import {
  IMPORT_PREVIEW_TTL_MS,
  MAX_IMPORT_CHUNK_BYTES,
  validateImportRowShape,
} from '../worker/mobile-import';
import {
  CANONICAL_EXPORT_HEADER,
  csvCell,
  createLedgerExportResponse,
  isFullLedgerSelection,
} from '../worker/mobile-export';

const fixtures: Array<{ dispose(): Promise<void> }> = [];

afterEach(async () => {
  while (fixtures.length > 0) await fixtures.pop()!.dispose();
});

const owner: OwnerContext = {
  credentialType: 'owner',
  ledgerId: 'personal',
  familyId: 'task12-family',
  subjectHash: 'task12-owner-hash',
  deviceId: null,
  accessGeneration: 1,
  scopes: ['imports:write', 'exports:read'],
  expiresAt: '2027-01-10T13:00:00.000Z',
  environmentHash: 'task12-environment-hash',
};

const ROUTE_ORIGIN = 'https://pf.example.com';
const ROUTE_ENVIRONMENT = 'sandbox';
const ROUTE_SESSION_KEY = 'task12-route-session-key';

function importRow(accountId: string, merchant = 'Cafe') {
  return {
    rowId: 'row-1',
    rowIndex: 0,
    accountId,
    date: '2026-10-13',
    merchant,
    amountMinor: -100,
    currency: 'CAD',
    category: 'Food',
    kind: 'expense' as const,
    status: 'confirmed' as const,
    source: 'statement' as const,
    fingerprint: 'row-1-fingerprint',
  };
}

async function routeOwner(db: Awaited<ReturnType<typeof createD1Fixture>>['db'], scopes: readonly OwnerScope[] = ['imports:write', 'exports:read']) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  const environmentHash = await hashSecret(ROUTE_ENVIRONMENT);
  await db.prepare(`INSERT INTO owner_session_families
    (id, ledger_id, subject_hash, access_generation, refresh_generation, access_expires_at, refresh_expires_at, scope_json, environment_hash, created_at)
    VALUES (?, 'personal', ?, 1, 1, ?, ?, ?, ?, ?)`).bind(
    'task12-route-family', 'task12-route-owner', expiresAt, expiresAt, JSON.stringify(scopes), environmentHash, now.toISOString(),
  ).run();
  const credential = await createOpaqueCredential({
    kind: 'owner-access',
    familyId: 'task12-route-family',
    generation: 1,
    expiresAt,
    environmentHash,
  }, {
    canonicalOrigin: ROUTE_ORIGIN,
    callbackUrl: `${ROUTE_ORIGIN}/android/auth/callback`,
    environment: ROUTE_ENVIRONMENT,
    accessAuthorizationUrl: 'https://access.example.com/authorize',
    sessionEncryptionKey: ROUTE_SESSION_KEY,
  });
  return credential;
}

function routeEnv(db: Awaited<ReturnType<typeof createD1Fixture>>['db']) {
  return {
    DB: db,
    LEDGER_APP_ORIGIN: ROUTE_ORIGIN,
    MOBILE_ENVIRONMENT: ROUTE_ENVIRONMENT,
    MOBILE_ACCESS_AUTHORIZATION_URL: `${ROUTE_ORIGIN}/mobile/authorize`,
    MOBILE_SESSION_ENCRYPTION_KEY: ROUTE_SESSION_KEY,
    ASSETS: { fetch: async () => new Response('not found', { status: 404 }) },
  };
}

describe('Task 12 mobile import/export primitives', () => {
  it('keeps import staging bounded to a 24-hour preview and 128 KiB chunks', () => {
    expect(IMPORT_PREVIEW_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(MAX_IMPORT_CHUNK_BYTES).toBe(128 * 1024);
  });

  it('rejects an unsafe or account-mismatched statement row before staging', () => {
    expect(validateImportRowShape({
      rowId: 'row-1',
      rowIndex: 0,
      accountId: 'account-1',
      date: '2026-10-13',
      merchant: 'Cafe',
      amountMinor: Number.MAX_SAFE_INTEGER + 1,
      currency: 'CAD',
      category: 'Food',
      kind: 'expense',
      status: 'confirmed',
      source: 'statement',
      fingerprint: 'row-1',
    }, 'account-2')).toMatchObject({ code: 'account_mismatch' });
  });

  it('accepts registered non-CAD/CNY import currencies and rejects unknown codes', () => {
    expect(validateImportRowShape({ ...importRow('account-1'), currency: 'EUR', amountMinor: -1234 }, 'account-1')).toBeNull();
    expect(validateImportRowShape({ ...importRow('account-1'), currency: 'XYZ' }, 'account-1')).toMatchObject({ code: 'invalid_currency' });
  });

  it('quotes Chinese and formula-like text without changing the minor-unit cell', () => {
    expect(csvCell('北京,=SUM(A1)')).toBe('"北京,\'=SUM(A1)"');
    expect(csvCell(-1234, { numeric: true })).toBe('-1234');
    expect(CANONICAL_EXPORT_HEADER).toContain('AmountMinor');
  });

  it('identifies the all-record selection that requires recent approval', () => {
    expect(isFullLedgerSelection('all', {})).toBe(true);
    expect(isFullLedgerSelection('current_filter', { currency: 'CAD' })).toBe(false);
    expect(isFullLedgerSelection('current_filter', {})).toBe(true);
  });

  it('rejects an unknown currency before starting a ledger export', async () => {
    await expect(createLedgerExportResponse({} as never, owner, { now: () => new Date('2027-01-10T12:00:00.000Z') }, {
      selection: 'current_filter',
      filters: { currency: 'XYZ' },
    })).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('persists modern preview metadata including the declared file size', async () => {
    const fixture = await createD1Fixture(task18MigrationNames);
    fixtures.push(fixture);
    await fixture.db.prepare(`INSERT INTO accounts (id, name, institution, currency, currency_mode, kind, status)
      VALUES ('task12-account', 'Task 12 account', 'Synthetic bank', 'CAD', 'single', 'chequing', 'import_only')`).run();

    const preview = await createImportPreviewForOwner(fixture.db, owner, {
      accountId: 'task12-account',
      fileName: 'statement.csv',
      fileSizeBytes: 4096,
      fileSha256: 'a'.repeat(64),
      format: 'csv',
      rowCount: 1,
      idempotencyKey: 'preview-1',
    }, new Date('2027-01-10T12:00:00.000Z'));

    expect(preview).toMatchObject({ id: expect.any(String), state: 'staged' });
    await expect(fixture.db.prepare('SELECT file_size_bytes FROM import_previews WHERE id = ?').bind(preview.id).all())
      .resolves.toMatchObject({ results: [{ file_size_bytes: 4096 }] });
  });

  it('rejects reusing a preview idempotency key with different file metadata', async () => {
    const fixture = await createD1Fixture(task18MigrationNames);
    fixtures.push(fixture);
    await fixture.db.prepare(`INSERT INTO accounts (id, name, institution, currency, currency_mode, kind, status)
      VALUES ('task12-idempotency-account', 'Task 12 account', 'Synthetic bank', 'CAD', 'single', 'chequing', 'import_only')`).run();

    const input = {
      accountId: 'task12-idempotency-account',
      fileName: 'statement.csv',
      fileSizeBytes: 4096,
      fileSha256: 'b'.repeat(64),
      format: 'csv' as const,
      rowCount: 1,
      idempotencyKey: 'preview-reused',
    };
    await createImportPreviewForOwner(fixture.db, owner, input, new Date('2027-01-10T12:00:00.000Z'));
    await expect(createImportPreviewForOwner(fixture.db, owner, { ...input, fileSizeBytes: 8192, fileSha256: 'f'.repeat(64) }, new Date('2027-01-10T12:00:00.000Z')))
      .rejects.toMatchObject({ code: 'idempotency_conflict', status: 409 });
  });

  it('allows a publication retry after the preview revision advanced to publishing', async () => {
    const fixture = await createD1Fixture(task18MigrationNames);
    fixtures.push(fixture);
    await fixture.db.prepare(`INSERT INTO accounts (id, name, institution, currency, currency_mode, kind, status)
      VALUES ('task12-publication-account', 'Task 12 account', 'Synthetic bank', 'CAD', 'single', 'chequing', 'import_only')`).run();
    await fixture.db.prepare('DROP TRIGGER transactions_fx_lock_date_default').run();
    const preview = await createImportPreviewForOwner(fixture.db, owner, {
      accountId: 'task12-publication-account',
      fileName: 'statement.csv',
      fileSizeBytes: 4096,
      fileSha256: 'c'.repeat(64),
      format: 'csv',
      rowCount: 1,
      idempotencyKey: 'publication-retry',
    }, new Date('2027-01-10T12:00:00.000Z'));
    const row = importRow('task12-publication-account');
    const staged = await (await import('../worker/mobile-import')).stageImportChunkForOwner(fixture.db, owner, {
      previewId: preview.id,
      chunkIndex: 0,
      operationId: 'chunk-publication-retry',
      rowStart: 0,
      rows: [row],
    });
    await fixture.db.prepare(`UPDATE import_previews SET status = 'publishing', operation_id = ?, selected_row_ids_json = ?, selected_count = 1, revision = revision + 1 WHERE id = ?`)
      .bind('commit-publication-retry', JSON.stringify(['row-1']), preview.id).run();

    const result = await commitImportForOwner(fixture.db, owner, {
      previewId: preview.id,
      expectedRevision: staged.revision,
      rowIds: ['row-1'],
      operationId: 'commit-publication-retry',
    });
    expect(result.publishedRows).toBe(1);
    await expect(fixture.db.prepare('SELECT date, fx_lock_date, COUNT(*) AS count FROM transactions WHERE source = ?').bind('statement').all())
      .resolves.toMatchObject({ results: [{ date: '2026-10-13', fx_lock_date: '2026-10-13', count: 1 }] });
  });

  it('returns a non-empty duplicateCandidates contract with the canonical candidate shape', async () => {
    const fixture = await createD1Fixture(task18MigrationNames);
    fixtures.push(fixture);
    await fixture.db.prepare(`INSERT INTO accounts (id, name, institution, currency, currency_mode, kind, status)
      VALUES ('task12-duplicate-account', 'Task 12 account', 'Synthetic bank', 'CAD', 'single', 'chequing', 'import_only')`).run();
    await fixture.db.prepare(`INSERT INTO transactions
      (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint)
      VALUES ('alert-candidate-1', 'task12-duplicate-account', '2026-10-13', 'Cafe', -100, 'CAD', 'Food', 'expense', 'confirmed', 'alert', 'alert-fingerprint')`).run();
    await fixture.db.prepare(`INSERT INTO transaction_source_records
      (id, source_kind, identity_key, transaction_id, account_id, event_id, content_digest)
      VALUES ('alert-source-1', 'alert', 'alert:source-1', 'alert-candidate-1', 'task12-duplicate-account', 'alert-event-1', 'alert-content-1')`).run();

    const preview = await createImportPreviewForOwner(fixture.db, owner, {
      accountId: 'task12-duplicate-account',
      fileName: 'duplicates.csv',
      fileSizeBytes: 4096,
      fileSha256: 'f'.repeat(64),
      format: 'csv',
      rowCount: 1,
      idempotencyKey: 'duplicate-contract',
    }, new Date('2027-01-10T12:00:00.000Z'));
    const staged = await (await import('../worker/mobile-import')).stageImportChunkForOwner(fixture.db, owner, {
      previewId: preview.id,
      chunkIndex: 0,
      operationId: 'chunk-duplicate-contract',
      rowStart: 0,
      rows: [importRow('task12-duplicate-account')],
    });

    expect(staged.duplicateCandidates).toEqual([{
      id: expect.any(String),
      statementTransactionId: 'row-1',
      candidateTransactionId: 'alert-candidate-1',
      score: 100,
      reasonCodes: expect.arrayContaining(['same_account', 'same_currency', 'same_amount']),
      status: 'open',
    }]);
    await expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE source = ?').bind('statement').all())
      .resolves.toMatchObject({ results: [{ count: 0 }] });
    await expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM transaction_source_records WHERE source_kind = ?').bind('statement').all())
      .resolves.toMatchObject({ results: [{ count: 0 }] });
    await expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM statement_reconciliation_candidates').all())
      .resolves.toMatchObject({ results: [{ count: 0 }] });

    await expect(commitImportForOwner(fixture.db, owner, {
      previewId: preview.id,
      expectedRevision: staged.revision,
      rowIds: ['row-1'],
      operationId: 'commit-duplicate-contract',
    })).rejects.toMatchObject({ code: 'open_duplicate_candidates', status: 409 });

    const decided = await decideImportDuplicateForOwner(fixture.db, owner, {
      previewId: preview.id,
      candidateId: staged.duplicateCandidates[0].id,
      expectedRevision: staged.revision,
      decision: 'resolve',
    });
    expect(decided.duplicateCandidates[0]).toMatchObject({ status: 'accepted' });
    await expect(decideImportDuplicateForOwner(fixture.db, owner, {
      previewId: preview.id,
      candidateId: staged.duplicateCandidates[0].id,
      expectedRevision: staged.revision,
      decision: 'resolve',
    })).resolves.toMatchObject({ revision: decided.revision });

    const committed = await commitImportForOwner(fixture.db, owner, {
      previewId: preview.id,
      expectedRevision: decided.revision,
      rowIds: ['row-1'],
      operationId: 'commit-duplicate-contract',
    });

    expect(committed.duplicateCandidates).toEqual([{
      id: expect.any(String),
      statementTransactionId: expect.any(String),
      candidateTransactionId: 'alert-candidate-1',
      score: expect.any(Number),
      reasonCodes: expect.arrayContaining(['same_account', 'same_currency', 'same_amount']),
      status: 'accepted',
    }]);
    expect(committed.duplicateCandidates[0]).toMatchObject({
      id: staged.duplicateCandidates[0].id,
      status: 'accepted',
    });
  }, 15_000);

  it('calculates statement-overlap candidates from staged rows without publishing ledger state', async () => {
    const fixture = await createD1Fixture(task18MigrationNames);
    fixtures.push(fixture);
    await fixture.db.prepare(`INSERT INTO accounts (id, name, institution, currency, currency_mode, kind, status)
      VALUES ('task12-statement-candidate-account', 'Task 12 account', 'Synthetic bank', 'CAD', 'single', 'chequing', 'import_only')`).run();
    await fixture.db.prepare(`INSERT INTO transactions
      (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint)
      VALUES ('statement-candidate-1', 'task12-statement-candidate-account', '2026-10-13', 'Cafe', -100, 'CAD', 'Food', 'expense', 'confirmed', 'statement', 'existing-fingerprint')`).run();
    await fixture.db.prepare(`INSERT INTO transaction_source_records
      (id, source_kind, identity_key, transaction_id, account_id, file_sha256, row_index, content_digest)
      VALUES ('statement-source-1', 'statement', 'statement:task12-statement-candidate-account:${'a'.repeat(64)}:0', 'statement-candidate-1', 'task12-statement-candidate-account', ?, 0, 'existing-content')`).bind('a'.repeat(64)).run();

    const preview = await createImportPreviewForOwner(fixture.db, owner, {
      accountId: 'task12-statement-candidate-account',
      fileName: 'overlap.csv',
      fileSizeBytes: 4096,
      fileSha256: 'b'.repeat(64),
      format: 'csv',
      rowCount: 1,
      idempotencyKey: 'statement-candidate-preview',
    }, new Date('2027-01-10T12:00:00.000Z'));
    const staged = await (await import('../worker/mobile-import')).stageImportChunkForOwner(fixture.db, owner, {
      previewId: preview.id,
      chunkIndex: 0,
      operationId: 'statement-candidate-chunk',
      rowStart: 0,
      rows: [importRow('task12-statement-candidate-account')],
    });

    expect(staged.duplicateCandidates).toEqual([{
      id: expect.any(String),
      statementTransactionId: 'row-1',
      candidateTransactionId: 'statement-candidate-1',
      score: 95,
      reasonCodes: expect.arrayContaining(['same_account', 'same_currency', 'same_amount', 'same_kind', 'same_date', 'merchant_match']),
      status: 'open',
    }]);
    await expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM transactions').all())
      .resolves.toMatchObject({ results: [{ count: 1 }] });
    await expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM transaction_source_records').all())
      .resolves.toMatchObject({ results: [{ count: 1 }] });
    await expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM statement_reconciliation_candidates').all())
      .resolves.toMatchObject({ results: [{ count: 0 }] });
  }, 15_000);

  it('does not allow a publishing operation to change its selected rows', async () => {
    const fixture = await createD1Fixture(task18MigrationNames);
    fixtures.push(fixture);
    await fixture.db.prepare(`INSERT INTO accounts (id, name, institution, currency, currency_mode, kind, status)
      VALUES ('task12-operation-account', 'Task 12 account', 'Synthetic bank', 'CAD', 'single', 'chequing', 'import_only')`).run();
    const preview = await createImportPreviewForOwner(fixture.db, owner, {
      accountId: 'task12-operation-account',
      fileName: 'statement.csv',
      fileSizeBytes: 4096,
      fileSha256: '7'.repeat(64),
      format: 'csv',
      rowCount: 2,
      idempotencyKey: 'operation-selection',
    }, new Date('2027-01-10T12:00:00.000Z'));
    const row1 = importRow('task12-operation-account');
    const row2 = { ...row1, rowId: 'row-2', rowIndex: 1, fingerprint: 'row-2-fingerprint' };
    const staged = await (await import('../worker/mobile-import')).stageImportChunkForOwner(fixture.db, owner, {
      previewId: preview.id,
      chunkIndex: 0,
      operationId: 'chunk-operation-selection',
      rowStart: 0,
      rows: [row1, row2],
    });
    await fixture.db.prepare(`UPDATE import_previews SET status = 'publishing', operation_id = ?, selected_row_ids_json = ?, revision = revision + 1 WHERE id = ?`)
      .bind('commit-operation-selection', JSON.stringify(['row-1']), preview.id).run();

    await expect(commitImportForOwner(fixture.db, owner, {
      previewId: preview.id,
      expectedRevision: staged.revision,
      rowIds: ['row-2'],
      operationId: 'commit-operation-selection',
    })).rejects.toMatchObject({ code: 'operation_conflict', status: 409 });
    await expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE source = ?').bind('statement').all())
      .resolves.toMatchObject({ results: [{ count: 0 }] });
  });

  it('serves owner import lifecycle methods and a complete CSV export', async () => {
    const fixture = await createD1Fixture(task18MigrationNames);
    fixtures.push(fixture);
    await fixture.db.prepare(`INSERT INTO accounts (id, name, institution, currency, currency_mode, kind, status)
      VALUES ('task12-route-account', 'Task 12 account', 'Synthetic bank', 'CAD', 'single', 'chequing', 'import_only')`).run();
    const token = await routeOwner(fixture.db);
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const fileSha256 = 'd'.repeat(64);
    const previewResponse = await worker.fetch(new Request(`${ROUTE_ORIGIN}/api/mobile/v1/imports/previews`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': 'route-preview-1' },
      body: JSON.stringify({ accountId: 'task12-route-account', fileName: 'route.csv', fileSizeBytes: 256, fileSha256, format: 'csv', rowCount: 1 }),
    }), routeEnv(fixture.db) as never);
    expect(previewResponse.status).toBe(201);
    const preview = await previewResponse.json() as { id: string; revision: number };
    const chunkResponse = await worker.fetch(new Request(`${ROUTE_ORIGIN}/api/mobile/v1/imports/${encodeURIComponent(preview.id)}/chunks/0`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': 'route-chunk-1' },
      body: JSON.stringify({ rowStart: 0, rows: [importRow('task12-route-account')] }),
    }), routeEnv(fixture.db) as never);
    expect(chunkResponse.status).toBe(200);
    const chunk = await chunkResponse.json() as { revision: number; state: string };
    expect(chunk.state).toBe('ready');
    const conflictingChunkResponse = await worker.fetch(new Request(`${ROUTE_ORIGIN}/api/mobile/v1/imports/${encodeURIComponent(preview.id)}/chunks/0`, {
      method: 'PUT',
      headers: { ...headers, 'idempotency-key': 'route-chunk-different' },
      body: JSON.stringify({ rowStart: 0, rows: [{ ...importRow('task12-route-account'), merchant: 'Different Cafe' }] }),
    }), routeEnv(fixture.db) as never);
    expect(conflictingChunkResponse.status).toBe(409);
    await expect(conflictingChunkResponse.json()).resolves.toMatchObject({ code: 'chunk_conflict', retryable: false });
    const commitRequest = () => new Request(`${ROUTE_ORIGIN}/api/mobile/v1/imports/${encodeURIComponent(preview.id)}/commit`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': 'route-commit-1' },
      body: JSON.stringify({ expectedRevision: chunk.revision, rowIds: ['row-1'] }),
    });
    const commitResponse = await worker.fetch(commitRequest(), routeEnv(fixture.db) as never);
    expect(commitResponse.status).toBe(200);
    const committed = await commitResponse.json() as { receiptId: string; publishedRows: number };
    expect(committed.publishedRows).toBe(1);
    await expect(worker.fetch(commitRequest(), routeEnv(fixture.db) as never).then((response) => response.json()))
      .resolves.toMatchObject({ receiptId: committed.receiptId, publishedRows: 1 });

    const exportResponse = await worker.fetch(new Request(`${ROUTE_ORIGIN}/api/mobile/v1/exports/transactions?selection=current_filter&currency=CAD`, {
      headers: { authorization: `Bearer ${token}` },
    }), routeEnv(fixture.db) as never);
    expect(exportResponse.status).toBe(200);
    expect(exportResponse.headers.get('content-type')).toContain('text/csv');
    expect(exportResponse.headers.get('x-worker-receipt-id')).toMatch(/^export-/);
    expect(exportResponse.headers.get('x-worker-exported-rows')).toBe('1');
    await expect(exportResponse.text()).resolves.toContain('row-1');
  });

  it('cancels an owner preview and rejects export without its scope', async () => {
    const fixture = await createD1Fixture(task18MigrationNames);
    fixtures.push(fixture);
    await fixture.db.prepare(`INSERT INTO accounts (id, name, institution, currency, currency_mode, kind, status)
      VALUES ('task12-cancel-account', 'Task 12 account', 'Synthetic bank', 'CAD', 'single', 'chequing', 'import_only')`).run();
    const importToken = await routeOwner(fixture.db, ['imports:write']);
    const response = await worker.fetch(new Request(`${ROUTE_ORIGIN}/api/mobile/v1/imports/previews`, {
      method: 'POST',
      headers: { authorization: `Bearer ${importToken}`, 'content-type': 'application/json', 'idempotency-key': 'route-cancel-1' },
      body: JSON.stringify({ accountId: 'task12-cancel-account', fileName: 'cancel.csv', fileSizeBytes: 256, fileSha256: 'e'.repeat(64), format: 'csv', rowCount: 1 }),
    }), routeEnv(fixture.db) as never);
    const preview = await response.json() as { id: string };
    const canceled = await worker.fetch(new Request(`${ROUTE_ORIGIN}/api/mobile/v1/imports/${encodeURIComponent(preview.id)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${importToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 0 }),
    }), routeEnv(fixture.db) as never);
    expect(canceled.status).toBe(200);
    await expect(canceled.json()).resolves.toMatchObject({ id: preview.id, state: 'cancelled' });
    const exportResponse = await worker.fetch(new Request(`${ROUTE_ORIGIN}/api/mobile/v1/exports/transactions?selection=current_filter&currency=CAD`, {
      headers: { authorization: `Bearer ${importToken}` },
    }), routeEnv(fixture.db) as never);
    expect(exportResponse.status).toBe(403);
    await expect(exportResponse.json()).resolves.toMatchObject({ code: 'forbidden', retryable: false });
  });

  it('requires a matching cancellation revision and fences publishing previews', async () => {
    const fixture = await createD1Fixture(task18MigrationNames);
    fixtures.push(fixture);
    await fixture.db.prepare(`INSERT INTO accounts (id, name, institution, currency, currency_mode, kind, status)
      VALUES ('task12-cancel-fence-account', 'Task 12 account', 'Synthetic bank', 'CAD', 'single', 'chequing', 'import_only')`).run();
    const importToken = await routeOwner(fixture.db, ['imports:write']);
    const headers = { authorization: `Bearer ${importToken}`, 'content-type': 'application/json' };
    const response = await worker.fetch(new Request(`${ROUTE_ORIGIN}/api/mobile/v1/imports/previews`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': 'route-cancel-fence-1' },
      body: JSON.stringify({ accountId: 'task12-cancel-fence-account', fileName: 'cancel.csv', fileSizeBytes: 256, fileSha256: '1'.repeat(64), format: 'csv', rowCount: 1 }),
    }), routeEnv(fixture.db) as never);
    const preview = await response.json() as { id: string; revision: number };
    await fixture.db.prepare(`UPDATE import_previews SET status = 'publishing', operation_id = 'commit-fence', revision = revision + 1 WHERE id = ?`)
      .bind(preview.id).run();

    const canceled = await worker.fetch(new Request(`${ROUTE_ORIGIN}/api/mobile/v1/imports/${encodeURIComponent(preview.id)}`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ expectedRevision: preview.revision }),
    }), routeEnv(fixture.db) as never);

    expect(canceled.status).toBe(409);
    await expect(canceled.json()).resolves.toMatchObject({ code: 'revision_conflict', retryable: false });
    await expect(fixture.db.prepare('SELECT status FROM import_previews WHERE id = ?').bind(preview.id).all())
      .resolves.toMatchObject({ results: [{ status: 'publishing' }] });
  });

  it('requires recent owner approval for an unfiltered all-record export', async () => {
    const fixture = await createD1Fixture(task18MigrationNames);
    fixtures.push(fixture);
    const token = await routeOwner(fixture.db, ['exports:read']);
    await fixture.db.prepare(`UPDATE owner_session_families SET created_at = '2000-01-01T00:00:00.000Z' WHERE id = ?`)
      .bind('task12-route-family').run();
    const response = await worker.fetch(new Request(`${ROUTE_ORIGIN}/api/mobile/v1/exports/transactions?selection=all`, {
      headers: { authorization: `Bearer ${token}` },
    }), routeEnv(fixture.db) as never);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'recent_approval_required', retryable: false });

    const invalidDateResponse = await worker.fetch(new Request(`${ROUTE_ORIGIN}/api/mobile/v1/exports/transactions?selection=current_filter&startDate=2026-02-30`, {
      headers: { authorization: `Bearer ${token}` },
    }), routeEnv(fixture.db) as never);
    expect(invalidDateResponse.status).toBe(400);
    await expect(invalidDateResponse.json()).resolves.toMatchObject({ code: 'invalid_request', retryable: false });
  });
});
