import { OWNER_LEDGER } from './helpers/tenants';
import { afterEach, describe, expect, it } from 'vitest';
import { applyMigrations, createD1Fixture, task24MigrationNames } from './helpers/d1';
import { appendAlertEventBatch, appendAlertEventLink, appendAlertProjection, appendTransactionSourceRecord, type AlertEventStorageInput } from '../worker/alert-store';
import { addSourceProfileHint, approveDeviceSourceScope, approveSourceAccountMapping, createDevicePairing, issueCaptureCredential, upsertSourceProfile } from '../worker/device-store';
import { appendAnnotationRevision } from '../worker/annotation-store';

const fixtures: Array<{ dispose(): Promise<void> }> = [];

afterEach(async () => {
  while (fixtures.length > 0) await fixtures.pop()?.dispose();
});

async function setup() {
  const fixture = await createD1Fixture();
  await applyMigrations(fixture.db, task24MigrationNames);
  await fixture.db.batch([
    fixture.db.prepare('INSERT INTO accounts (id, name, institution, currency, currency_mode, kind, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind('account-boc', 'Synthetic BOC card', 'BOC', 'CNY', 'multi', 'credit', 'connected'),
    fixture.db.prepare('INSERT OR IGNORE INTO account_currencies (account_id, currency) VALUES (?, ?)').bind('account-boc', 'CNY'),
    fixture.db.prepare('INSERT OR IGNORE INTO account_currencies (account_id, currency) VALUES (?, ?)').bind('account-boc', 'CAD'),
  ]);
  await upsertSourceProfile(fixture.db, OWNER_LEDGER, { id: 'source-boc', provider: 'boc', sourceKind: 'wechat', displayName: 'Synthetic BOC WeChat', parserVersion: 'parser-test-1', status: 'approved' });
  await addSourceProfileHint(fixture.db, OWNER_LEDGER, { id: 'hint-1', sourceProfileId: 'source-boc', hintKind: 'card_suffix', hintValue: '1234' });
  await approveSourceAccountMapping(fixture.db, OWNER_LEDGER, { id: 'mapping-1', sourceProfileId: 'source-boc', hintKind: 'card_suffix', hintValue: '1234', accountId: 'account-boc', approvedAt: '2026-10-13T00:00:00.000Z' });
  fixtures.push(fixture);
  return fixture;
}

function event(overrides: Partial<AlertEventStorageInput> = {}): AlertEventStorageInput {
  return {
    id: 'event-1',
    eventId: 'event-1',
    observationId: 'observation-1',
    sourceProfileId: 'source-boc',
    parserVersion: 'parser-test-1',
    notificationPostedAt: '2026-10-13T04:00:00.000Z',
    capturedAt: '2026-10-13T04:00:01.000Z',
    eventTimeBasis: 'notification_posted',
    eventType: 'purchase_notice',
    direction: 'outflow',
    instrumentHintKind: 'card_suffix',
    instrumentHintValue: '1234',
    accountId: 'account-boc',
    eventMoneyCurrency: 'CAD',
    eventMoneyAmountMinor: 1234,
    primaryMoneyRole: 'transaction',
    amountsJson: JSON.stringify([{ role: 'transaction', currency: 'CAD', amountMinor: 1234 }]),
    feeTreatment: 'included',
    bankReference: 'synthetic-reference-1',
    bankDisplayedTime: '2026-10-13 12:00',
    bankDisplayedZone: 'Asia/Shanghai',
    bankDisplayedPrecision: 'minute',
    bankYearProvenance: 'explicit',
    merchant: 'Synthetic merchant',
    completenessJson: JSON.stringify({ individualTimestamp: true, supportedSource: true, labeledMoney: true }),
    payloadDigest: 'digest-event-1',
    ...overrides,
  };
}

describe('Task 3 alert and device stores', () => {
  it('rejects mismatched source provenance in the store and through direct D1 writes', async () => {
    const fixture = await setup();
    await fixture.db.prepare('INSERT INTO accounts (id, name, institution, currency, kind, status) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('account-other', 'Synthetic other account', 'Other bank', 'CAD', 'chequing', 'connected').run();
    await fixture.db.prepare(`INSERT INTO transactions
      (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      'source-owner', 'account-boc', '2026-10-13', 'Synthetic source owner', -100, 'CAD', 'Other', 'expense', 'confirmed', 'manual', 'source-owner',
    ).run();

    await expect(appendTransactionSourceRecord(fixture.db, OWNER_LEDGER, {
      id: 'source-mismatch-store',
      sourceKind: 'statement',
      transactionId: 'source-owner',
      accountId: 'account-other',
      bankSourceId: 'synthetic-bank',
      bankRowId: 'row-1',
      contentDigest: 'digest-mismatch-store',
    })).rejects.toThrow(/account|transaction|mismatch|foreign key/i);
    await expect(fixture.db.prepare(`INSERT INTO transaction_source_records
      (id, source_kind, identity_key, transaction_id, account_id, bank_source_id, bank_row_id, content_digest)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      'source-mismatch-direct', 'statement', 'statement:account-other:synthetic-bank:row-2', 'source-owner', 'account-other', 'synthetic-bank', 'row-2', 'digest-mismatch-direct',
    ).run()).rejects.toThrow(/foreign key|constraint|mismatch/i);
  });

  it('stores only approved source-scoped capture data and commits alert evidence/projection atomically', async () => {
    const fixture = await setup();
    await createDevicePairing(fixture.db, OWNER_LEDGER, {
      deviceId: 'device-1',
      pairingId: 'pairing-1',
      deviceName: 'Synthetic Pixel',
      platform: 'android',
      deviceVerifierHash: 'hash-device-verifier',
      userCodeHash: 'hash-user-code',
      expiresAt: '2026-10-13T00:10:00.000Z',
    });
    await fixture.db.prepare("UPDATE mobile_devices SET status='paired' WHERE id='device-1'").run();
    await issueCaptureCredential(fixture.db, OWNER_LEDGER, {
      id: 'capture-1',
      deviceId: 'device-1',
      credentialHash: 'hash-capture-credential',
      generation: 1,
      issuedAt: '2026-10-13T00:00:00.000Z',
      expiresAt: '2027-01-11T00:00:00.000Z',
    });
    await approveDeviceSourceScope(fixture.db, OWNER_LEDGER, {
      id: 'scope-1',
      instrumentHint:{kind:'card_suffix',value:'1234'},
      deviceId: 'device-1',
      sourceProfileId: 'source-boc',
      accountId: 'account-boc',
      currency: 'CAD',
      expiresAt: '2027-01-11T00:00:00.000Z',
    });
    await appendAlertEventBatch(fixture.db, OWNER_LEDGER, [event()]);
    await appendAlertProjection(fixture.db, OWNER_LEDGER, {
      id: 'projection-1',
      eventId: 'event-1',
      state: 'provisional',
      reasonCodes: [],
      countedCurrency: 'CAD',
      countedAmountMinor: 1234,
      revision: 1,
      provenance: [{ sourceKind: 'alert', sourceId: 'event-1', basis: 'alert_event' }],
    });

    const capture = await fixture.db.prepare('SELECT credential_hash, credential_type, scope FROM capture_credentials WHERE id = ?').bind('capture-1').all();
    expect(capture.results).toEqual([{ credential_hash: 'hash-capture-credential', credential_type: 'capture', scope: 'alerts:write' }]);
    const projection = await fixture.db.prepare('SELECT event_id, state, counted_currency, counted_amount_minor FROM alert_projections').all();
    expect(projection.results).toEqual([{ event_id: 'event-1', state: 'provisional', counted_currency: 'CAD', counted_amount_minor: 1234 }]);
  });

  it('rejects an oversized or over-bounded alert batch before writing any event', async () => {
    const fixture = await setup();
    await expect(appendAlertEventBatch(fixture.db, OWNER_LEDGER, Array.from({ length: 51 }, (_, index) => event({
      id: `event-${index}`,
      eventId: `event-${index}`,
      observationId: `observation-${index}`,
      payloadDigest: `digest-${index}`,
    })))).rejects.toThrow(/50/);
    await expect(appendAlertEventBatch(fixture.db, OWNER_LEDGER, [event({ amountsJson: JSON.stringify([{ role: 'transaction', value: 'x'.repeat(140_000) }]) })])).rejects.toThrow(/128 KiB|bounded/i);
    await expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM alert_events').all()).resolves.toMatchObject({ results: [{ count: 0 }] });
  });

  it('bounds stored bank displayed time parts to their contract lengths', async () => {
    const fixture = await setup();
    await expect(appendAlertEventBatch(fixture.db, OWNER_LEDGER, [event({ bankDisplayedTime: 'x'.repeat(41) })])).rejects.toThrow(/bank displayed time|bounded/i);
    await expect(appendAlertEventBatch(fixture.db, OWNER_LEDGER, [event({ bankDisplayedZone: 'x'.repeat(65) })])).rejects.toThrow(/bank displayed zone|bounded/i);
    await expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM alert_events').all()).resolves.toMatchObject({ results: [{ count: 0 }] });
  });

  it('uses immutable event links and rejects a lifecycle cycle', async () => {
    const fixture = await setup();
    await appendAlertEventBatch(fixture.db, OWNER_LEDGER, [event(), event({ id: 'event-2', eventId: 'event-2', observationId: 'observation-2', payloadDigest: 'digest-event-1' })]);
    await appendAlertProjection(fixture.db, OWNER_LEDGER, {
      id: 'projection-1',
      eventId: 'event-1',
      state: 'provisional',
      reasonCodes: [],
      revision: 1,
      provenance: [{ sourceKind: 'alert', sourceId: 'event-1', basis: 'alert_event' }],
    });
    await appendAlertEventLink(fixture.db, OWNER_LEDGER, {
      id: 'link-1',
      fromEventId: 'event-2',
      toEventId: 'event-1',
      relation: 'cancels',
      evidenceBasis: 'bank_reference',
      revision: 1,
    });
    await expect(appendAlertEventLink(fixture.db, OWNER_LEDGER, {
      id: 'link-2',
      fromEventId: 'event-1',
      toEventId: 'event-2',
      relation: 'cancels',
      evidenceBasis: 'bank_reference',
      revision: 1,
    })).rejects.toThrow(/cycle/i);
    await expect(fixture.db.prepare('UPDATE alert_events SET merchant = ? WHERE id = ?').bind('changed', 'event-1').run()).rejects.toThrow(/immutable/i);
    await expect(fixture.db.prepare('DELETE FROM alert_event_digests WHERE event_id = ?').bind('event-1').run()).rejects.toThrow(/immutable/i);
    await expect(fixture.db.prepare('UPDATE alert_event_links SET relation = ? WHERE id = ?').bind('confirms', 'link-1').run()).rejects.toThrow(/immutable/i);
    await expect(fixture.db.prepare('DELETE FROM alert_projection_provenance WHERE projection_id = ?').bind('projection-1').run()).rejects.toThrow(/immutable/i);
    await fixture.db.prepare('INSERT INTO transactions (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind('annotation-transaction', 'account-boc', '2026-10-13', 'Synthetic annotation', -1, 'CAD', 'Other', 'expense', 'confirmed', 'manual', 'annotation-candidate').run();
    await appendAnnotationRevision(fixture.db, OWNER_LEDGER, {
      id: 'annotation-1',
      transactionId: 'annotation-transaction',
      authorSubjectHash: 'owner-hash',
      revision: 1,
      category: 'Food',
      note: 'Synthetic note',
    });
    await expect(fixture.db.prepare('UPDATE annotation_revisions SET note = ? WHERE id = ?').bind('changed', 'annotation-1').run()).rejects.toThrow(/immutable/i);
  });
});
