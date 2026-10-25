import { OWNER_LEDGER } from './helpers/tenants';
import { afterEach, describe, expect, it } from 'vitest';
import { applyMigrations, createD1Fixture, task3MigrationNames, task22MigrationNames } from './helpers/d1';
import { appendAnnotationRevision } from '../worker/annotation-store';
import { createImportPreview, publishImport, stageImportChunk, cleanupExpiredImportStaging } from '../worker/import-store';
import { createOwnerAuthRequest, createOwnerSessionFamily, putReplayRecord, cleanupExpiredReplayRecords } from '../worker/owner-session-store';
import { readPreferences, updatePreferences } from '../worker/preferences-store';

const fixtures: Array<{ dispose(): Promise<void> }> = [];

afterEach(async () => {
  while (fixtures.length > 0) await fixtures.pop()?.dispose();
});

async function setup() {
  const fixture = await createD1Fixture();
  await applyMigrations(fixture.db, task3MigrationNames);
  await fixture.db.prepare('INSERT INTO accounts (id, name, institution, currency, currency_mode, kind, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind('account-1', 'Synthetic account', 'BOC', 'CNY', 'multi', 'credit', 'connected').run();
  await fixture.db.prepare('INSERT OR IGNORE INTO account_currencies (account_id, currency) VALUES (?, ?)').bind('account-1', 'CNY').run();
  await fixture.db.prepare(`INSERT INTO transactions
    (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    'tx-1', 'account-1', '2026-10-13', 'Synthetic merchant', -100, 'CNY', 'Other', 'expense', 'confirmed', 'manual', 'tx-1-fingerprint',
  ).run();
  fixtures.push(fixture);
  return fixture;
}

describe('Task 3 native-parity stores', () => {
  it('keeps owner auth generations separate from bounded encrypted replay records', async () => {
    const fixture = await setup();
    await applyMigrations(fixture.db, task22MigrationNames);
    await createOwnerAuthRequest(fixture.db, { userId: 'owner', ledgerId: 'personal' }, {
      id: 'auth-request-1',
      stateHash: 'hash-state',
      pkceChallengeHash: 'hash-pkce',
      requestDigest: 'digest-request',
      expiresAt: '2026-10-13T00:10:00.000Z',
    });
    await createOwnerSessionFamily(fixture.db, { userId: 'owner', ledgerId: 'personal' }, {
      id: 'family-1',
      subjectHash: 'hash-subject',
      accessExpiresAt: '2026-10-13T00:15:00.000Z',
      refreshExpiresAt: '2026-10-14T00:00:00.000Z',
      refreshTokenHash: 'hash-refresh-1',
    });
    await putReplayRecord(fixture.db, { userId: 'owner', ledgerId: 'personal' }, {
      id: 'replay-1',
      requestKind: 'owner-exchange',
      requestDigest: 'digest-request',
      responseCiphertext: 'ciphertext-response',
      responseIv: 'iv-response',
      expiresAt: '2026-10-13T00:01:00.000Z',
      ttlSeconds: 60,
    });
    await expect(putReplayRecord(fixture.db, { userId: 'owner', ledgerId: 'personal' }, {
      id: 'replay-too-long',
      requestKind: 'owner-refresh',
      requestDigest: 'digest-refresh',
      responseCiphertext: 'ciphertext-response',
      responseIv: 'iv-response',
      expiresAt: '2026-10-13T00:02:01.000Z',
      ttlSeconds: 61,
    })).rejects.toThrow(/60/);

    const records = await fixture.db.prepare(`SELECT
      (SELECT COUNT(*) FROM mobile_auth_requests) AS auth_requests,
      (SELECT COUNT(*) FROM owner_session_families) AS families,
      (SELECT COUNT(*) FROM owner_refresh_generations) AS generations,
      (SELECT COUNT(*) FROM owner_replay_records) AS replays`).all();
    expect(records.results).toEqual([{ auth_requests: 1, families: 1, generations: 1, replays: 1 }]);
    await cleanupExpiredReplayRecords(fixture.db, { userId: 'owner', ledgerId: 'personal' }, '2026-10-13T00:01:00.000Z');
    await expect(fixture.db.prepare('SELECT id FROM owner_session_families').all()).resolves.toMatchObject({ results: [{ id: 'family-1' }] });
    await expect(fixture.db.prepare('SELECT id FROM owner_replay_records').all()).resolves.toMatchObject({ results: [] });
  });

  it('publishes staged imports atomically and cleans only expired unpublished staging', async () => {
    const fixture = await setup();
    await applyMigrations(fixture.db, task22MigrationNames);
    await createImportPreview(fixture.db, OWNER_LEDGER, {
      id: 'preview-1',
      accountId: 'account-1',
      filename: 'synthetic.csv',
      fileSha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      previewDigest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      rowCount: 2,
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    await stageImportChunk(fixture.db, OWNER_LEDGER, {
      previewId: 'preview-1',
      chunkIndex: 0,
      operationId: 'operation-1',
      chunkDigest: 'digest-chunk-0',
      rowStart: 0,
      rowCount: 2,
      rowsJson: JSON.stringify([{ row: 0, currency: 'CNY' }, { row: 1, currency: 'CNY' }]),
    });
    await publishImport(fixture.db, OWNER_LEDGER, {previewId:'preview-1',operationId:'operation-1',publishedAt:'2026-10-13T00:00:00.000Z'});
    await createImportPreview(fixture.db, OWNER_LEDGER, {
      id: 'preview-expired',
      accountId: 'account-1',
      filename: 'expired.csv',
      fileSha256: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      previewDigest: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      rowCount: 0,
      expiresAt: '2026-10-12T00:00:00.000Z',
    });
    await cleanupExpiredImportStaging(fixture.db, OWNER_LEDGER, '2026-10-13T00:00:00.000Z');
    await expect(fixture.db.prepare('SELECT id, status FROM import_previews ORDER BY id').all()).resolves.toMatchObject({ results: [{ id: 'preview-1', status: 'published' }] });
  });

  it('updates shared preferences by revision and appends immutable annotation revisions', async () => {
    const fixture = await setup();
    await applyMigrations(fixture.db, task22MigrationNames);
    await expect(readPreferences(fixture.db, OWNER_LEDGER)).resolves.toMatchObject({ ledgerId: 'personal', reportingTimezone: 'America/Toronto', weekStart: 1, revision: 0 });
    await expect(updatePreferences(fixture.db, OWNER_LEDGER, 0, { reportingTimezone: 'Asia/Shanghai', weekStart: 0, preferredCurrency: 'CNY' })).resolves.toMatchObject({ reportingTimezone: 'Asia/Shanghai', weekStart: 0, preferredCurrency: 'CNY', revision: 1 });
    await expect(updatePreferences(fixture.db, OWNER_LEDGER, 0, { reportingTimezone: 'UTC', weekStart: 1, preferredCurrency: null })).rejects.toThrow(/revision/i);
    await appendAnnotationRevision(fixture.db, OWNER_LEDGER, { id: 'annotation-1', transactionId: 'tx-1', authorSubjectHash: 'hash-owner', revision: 1, category: 'Travel', note: 'Synthetic note' });
    await expect(appendAnnotationRevision(fixture.db, OWNER_LEDGER, { id: 'annotation-2', transactionId: 'tx-1', authorSubjectHash: 'hash-owner', revision: 1, category: 'Other', note: 'Stale' })).rejects.toThrow();
  });
});
