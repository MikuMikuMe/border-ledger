import { describe, expect, it } from 'vitest';
import { createAlertFixture, event, postAlerts, ALERT_ENVIRONMENT, ALERT_ORIGIN, ALERT_SESSION_KEY, CAPTURE_SECRET } from './helpers/alerts';
import { assertCaptureEventScope, authenticateCapture } from '../worker/mobile-auth';
import { ingestAlertBatch } from '../worker/alert-ingestion';
import type { D1Database } from '../worker/db-types';
import { task18MigrationNames } from './helpers/d1';

describe('mobile alert ingestion', () => {
  it('commits valid, non-spending, and reviewable events independently within one batch', async () => {
    const fixture = await createAlertFixture({ migrationNames: task18MigrationNames });
    const response = await postAlerts(fixture.db, [
      event(),
      event({ eventId: '00000000-0000-4000-8000-000000000002', observationId: 'observation-2', eventType: 'declined', direction: 'none' }),
      event({ eventId: '00000000-0000-4000-8000-000000000003', observationId: 'observation-3', notificationPostedAt: null, completeness: { individualTimestamp: false, supportedSource: true, labeledMoney: true } }),
      event({ eventId: '00000000-0000-4000-8000-000000000004', observationId: 'observation-4', eventMoney: { currency: 'USD', amountMinor: 2000 }, amounts: [{ role: 'transaction', currency: 'USD', amountMinor: 2000 }] }),
      event({ eventId: '00000000-0000-4000-8000-000000000005', observationId: 'observation-5', eventMoney: { currency: 'ZZZ', amountMinor: 2000 }, amounts: [{ role: 'transaction', currency: 'ZZZ', amountMinor: 2000 }] }),
      event({ eventId: '00000000-0000-4000-8000-000000000006', observationId: 'observation-6', eventMoney: { currency: 'CAD', amountMinor: 12.3 }, amounts: [{ role: 'transaction', currency: 'CAD', amountMinor: 12.3 }] }),
    ]);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      acks: [
        { eventId: '00000000-0000-4000-8000-000000000001', status: 'accepted', projectionState: 'provisional' },
        { eventId: '00000000-0000-4000-8000-000000000002', status: 'accepted', projectionState: 'non_spending', reasonCodes: ['non_spending_event'] },
        { eventId: '00000000-0000-4000-8000-000000000003', status: 'accepted', projectionState: 'needs_review', reasonCodes: ['unresolved_time'] },
        { eventId: '00000000-0000-4000-8000-000000000004', status: 'rejected', projectionState: null, reasonCodes: ['out_of_scope'] },
        { eventId: '00000000-0000-4000-8000-000000000005', status: 'rejected', projectionState: null, reasonCodes: ['invalid_currency'] },
        { eventId: '00000000-0000-4000-8000-000000000006', status: 'rejected', projectionState: null, reasonCodes: ['invalid_money_scale'] },
      ],
    });
    await expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM alert_events').all()).resolves.toMatchObject({ results: [{ count: 3 }] });
    await expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM transactions').all()).resolves.toMatchObject({ results: [{ count: 1 }] });
  });

  it('locks an alert transaction on the canonical event date and keeps replay idempotent', async () => {
    const fixture = await createAlertFixture({ migrationNames: task18MigrationNames });
    await fixture.db.prepare('DROP TRIGGER transactions_fx_lock_date_default').run();
    const input = event({
      eventId: '00000000-0000-4000-8000-000000000007',
      observationId: 'observation-lock-7',
      notificationPostedAt: '2026-10-09T23:55:00.000Z',
      capturedAt: '2026-10-10T00:00:01.000Z',
    });

    expect((await postAlerts(fixture.db, [input])).status).toBe(200);
    expect((await postAlerts(fixture.db, [input])).status).toBe(200);

    await expect(fixture.db.prepare(`SELECT date, fx_lock_date, COUNT(*) AS count
      FROM transactions WHERE id = ?`).bind(input.eventId).all()).resolves.toMatchObject({
      results: [{ date: '2026-10-09', fx_lock_date: '2026-10-09', count: 1 }],
    });
  });

  it('rejects an impossible RFC3339 calendar date', async () => {
    const fixture = await createAlertFixture({ migrationNames: task18MigrationNames });
    const response = await postAlerts(fixture.db, [event({ notificationPostedAt: '2027-02-30T12:00:00Z' })]);

    expect(await response.json()).toMatchObject({ acks: [{ status: 'rejected', reasonCodes: ['invalid_time'] }] });
    await expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM alert_events').all()).resolves.toMatchObject({ results: [{ count: 0 }] });
  });

  it('accepts a valid RFC3339 offset and a null notification timestamp', async () => {
    const fixture = await createAlertFixture({ migrationNames: task18MigrationNames });
    const response = await postAlerts(fixture.db, [
      event({ eventId: '00000000-0000-4000-8000-000000000012', observationId: 'observation-12', notificationPostedAt: '2026-10-13T00:00:00-04:00' }),
      event({ eventId: '00000000-0000-4000-8000-000000000013', observationId: 'observation-13', notificationPostedAt: null, completeness: { individualTimestamp: false, supportedSource: true, labeledMoney: true } }),
    ]);

    expect(await response.json()).toMatchObject({ acks: [
      { eventId: '00000000-0000-4000-8000-000000000012', status: 'accepted' },
      { eventId: '00000000-0000-4000-8000-000000000013', status: 'accepted' },
    ] });
    await expect(fixture.db.prepare('SELECT notification_posted_at FROM alert_events ORDER BY event_id').all()).resolves.toMatchObject({ results: [
      { notification_posted_at: '2026-10-13T00:00:00-04:00' },
      { notification_posted_at: null },
    ] });
  });

  it('rejects a malformed, oversized, or over-50 envelope before any mutation', async () => {
    const fixture = await createAlertFixture({ migrationNames: task18MigrationNames });
    const malformed = await postAlerts(fixture.db, [event({ eventId: 'bad-event', observationId: 'bad' })]);
    expect(malformed.status).toBe(200);
    expect(await malformed.json()).toMatchObject({ acks: [{ status: 'rejected', reasonCodes: ['invalid_event_id'] }] });
    const tooMany = await postAlerts(fixture.db, Array.from({ length: 51 }, (_, index) => event({ eventId: `00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`, observationId: `observation-${index}` })));
    expect(tooMany.status).toBe(400);
    const oversized = await postAlerts(fixture.db, [event({ merchant: 'x'.repeat(140_000) })]);
    expect(oversized.status).toBe(413);
    await expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM alert_events').all()).resolves.toMatchObject({ results: [{ count: 0 }] });
  });

  it('rejects bank displayed time when required fields are omitted or local time exceeds 40 characters', async () => {
    const fixture = await createAlertFixture({ migrationNames: task18MigrationNames });
    const response = await postAlerts(fixture.db, [
      event({
        eventId: '00000000-0000-4000-8000-000000000007',
        bankDisplayedTime: { zone: 'Asia/Shanghai', precision: 'minute', yearProvenance: 'explicit' } as never,
      }),
      event({
        eventId: '00000000-0000-4000-8000-000000000008',
        bankDisplayedTime: { localDateTime: '2026-10-13 12:00', precision: 'minute', yearProvenance: 'explicit' } as never,
      }),
      event({
        eventId: '00000000-0000-4000-8000-000000000009',
        bankDisplayedTime: { localDateTime: 'x'.repeat(41), zone: 'Asia/Shanghai', precision: 'minute', yearProvenance: 'explicit' },
      }),
    ]);

    expect(await response.json()).toMatchObject({ acks: [
      { eventId: '00000000-0000-4000-8000-000000000007', status: 'rejected', reasonCodes: ['invalid_time'] },
      { eventId: '00000000-0000-4000-8000-000000000008', status: 'rejected', reasonCodes: ['invalid_time'] },
      { eventId: '00000000-0000-4000-8000-000000000009', status: 'rejected', reasonCodes: ['invalid_time'] },
    ] });
    await expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM alert_events').all()).resolves.toMatchObject({ results: [{ count: 0 }] });
  });

  it('accepts null source parts when a bank displayed time object preserves all four keys', async () => {
    const fixture = await createAlertFixture({ migrationNames: task18MigrationNames });
    const response = await postAlerts(fixture.db, [
      event({
        eventId: '00000000-0000-4000-8000-000000000010',
        observationId: 'observation-10',
        bankDisplayedTime: { localDateTime: null, zone: 'Asia/Shanghai', precision: 'minute', yearProvenance: 'explicit' },
      }),
      event({
        eventId: '00000000-0000-4000-8000-000000000011',
        observationId: 'observation-11',
        bankDisplayedTime: { localDateTime: '2026-10-13 12:00', zone: null, precision: 'minute', yearProvenance: 'explicit' },
      }),
    ]);

    expect(await response.json()).toMatchObject({ acks: [
      { eventId: '00000000-0000-4000-8000-000000000010', status: 'accepted' },
      { eventId: '00000000-0000-4000-8000-000000000011', status: 'accepted' },
    ] });
    await expect(fixture.db.prepare('SELECT bank_displayed_time, bank_displayed_zone FROM alert_events ORDER BY event_id').all()).resolves.toMatchObject({ results: [
      { bank_displayed_time: null, bank_displayed_zone: 'Asia/Shanghai' },
      { bank_displayed_time: '2026-10-13 12:00', bank_displayed_zone: null },
    ] });
  });

  it('rejects a hinted event when the device scope is explicitly no-hint', async () => {
    const fixture = await createAlertFixture({ migrationNames: task18MigrationNames });
    await fixture.db.prepare(`INSERT INTO source_account_mappings
      (id, ledger_id, source_profile_id, hint_kind, hint_value, account_id, approval_status, approved_at)
      VALUES (?, 'personal', 'source-boc', 'card_suffix', '9999', 'account-boc', 'approved', '2026-10-13T04:00:00.000Z')`)
      .bind('mapping-boc-9999').run();

    const response = await postAlerts(fixture.db, [event({
      eventId: '00000000-0000-4000-8000-000000000014',
      observationId: 'observation-14',
      instrumentHint: { kind: 'card_suffix', value: '9999' },
    })]);

    expect(await response.json()).toMatchObject({ acks: [{ status: 'rejected', projectionState: null, reasonCodes: ['out_of_scope'] }] });
    await expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM alert_events').all()).resolves.toMatchObject({ results: [{ count: 0 }] });
  });

  it('preserves a supported non-CAD/CNY event currency through capture scope and projection', async () => {
    const fixture = await createAlertFixture({ migrationNames: task18MigrationNames });
    await fixture.db.prepare(`INSERT OR IGNORE INTO account_currencies (account_id, currency) VALUES ('account-boc', 'EUR')`).run();
    await fixture.db.prepare(`INSERT INTO device_source_scopes (id, device_id, source_profile_id, account_id, currency, status)
      VALUES (?, 'capture-device', 'source-boc', 'account-boc', 'EUR', 'approved')`).bind('capture-scope-eur').run();

    const response = await postAlerts(fixture.db, [event({
      eventId: '00000000-0000-4000-8000-000000000015',
      observationId: 'observation-15',
      eventMoney: { currency: 'EUR', amountMinor: 2345 },
      amounts: [{ role: 'transaction', currency: 'EUR', amountMinor: 2345 }],
    })]);

    expect(await response.json()).toMatchObject({ acks: [{ status: 'accepted', projectionState: 'provisional' }] });
    await expect(fixture.db.prepare(`SELECT event_money_currency FROM alert_events WHERE event_id = ?`).bind('00000000-0000-4000-8000-000000000015').first()).resolves.toMatchObject({ event_money_currency: 'EUR' });
    await expect(fixture.db.prepare(`SELECT counted_currency FROM alert_projections WHERE event_id = ?`).bind('00000000-0000-4000-8000-000000000015').first()).resolves.toMatchObject({ counted_currency: 'EUR' });
    await expect(fixture.db.prepare(`SELECT currency FROM transactions WHERE id = ?`).bind('00000000-0000-4000-8000-000000000015').first()).resolves.toMatchObject({ currency: 'EUR' });
  });

  it('matches a hinted capture scope exactly and rechecks the same tuple in SQL', async () => {
    const fixture = await createAlertFixture({ migrationNames: task18MigrationNames });
    await fixture.db.prepare(`UPDATE device_source_scopes SET instrument_hint_kind = 'card_suffix', instrument_hint_value = '1111'
      WHERE id = 'capture-scope-cad'`).run();

    const capture = await authenticateCapture(CAPTURE_SECRET, fixture.db, {
      canonicalOrigin: ALERT_ORIGIN,
      callbackUrl: `${ALERT_ORIGIN}/android/auth/callback`,
      environment: ALERT_ENVIRONMENT,
      accessAuthorizationUrl: 'https://access.example.com/authorize',
      sessionEncryptionKey: ALERT_SESSION_KEY,
    });
    expect(capture.sourceScopes).toEqual([{ sourceProfileId: 'source-boc', accountId: 'account-boc', currency: 'CAD', instrumentHint: { kind: 'card_suffix', value: '1111' } }]);

    const accepted = await postAlerts(fixture.db, [event({
      eventId: '00000000-0000-4000-8000-000000000016',
      observationId: 'observation-16',
      instrumentHint: { kind: 'card_suffix', value: '1111' },
    })]);
    expect(await accepted.json()).toMatchObject({ acks: [{ status: 'accepted', projectionState: 'provisional' }] });

    const mismatch = await postAlerts(fixture.db, [event({
      eventId: '00000000-0000-4000-8000-000000000017',
      observationId: 'observation-17',
      instrumentHint: { kind: 'card_suffix', value: '2222' },
    })]);
    expect(await mismatch.json()).toMatchObject({ acks: [{ status: 'rejected', projectionState: null, reasonCodes: ['out_of_scope'] }] });

    await fixture.db.prepare(`UPDATE device_source_scopes SET instrument_hint_value = '2222' WHERE id = 'capture-scope-cad'`).run();
    await expect(assertCaptureEventScope(fixture.db, capture, {
      sourceProfileId: 'source-boc',
      accountId: 'account-boc',
      currency: 'CAD',
      instrumentHint: { kind: 'card_suffix', value: '1111' },
    })).rejects.toThrow(/scope|approved/i);
  });

  it('rejects raw, unknown, and server-owned fields without persisting them', async () => {
    const fixture = await createAlertFixture({ migrationNames: task18MigrationNames });
    const response = await postAlerts(fixture.db, [
      { ...event(), rawNotificationText: 'do not store' } as never,
      { ...event({ eventId: '00000000-0000-4000-8000-000000000006', observationId: 'observation-6' }), ledgerId: 'personal' } as never,
    ]);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ acks: [
      { status: 'rejected', projectionState: null, reasonCodes: ['unknown_field'] },
      { status: 'rejected', projectionState: null, reasonCodes: ['unknown_field'] },
    ] });
    await expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM alert_events').all()).resolves.toMatchObject({ results: [{ count: 0 }] });
  });

  it('returns no acknowledgement and leaves no evidence when the D1 commit fails', async () => {
    const fixture = await createAlertFixture({ migrationNames: task18MigrationNames });
    const capture = await authenticateCapture('capture-secret-alert-tests', fixture.db, {
      canonicalOrigin: 'https://pf.example.com',
      callbackUrl: 'https://pf.example.com/android/auth/callback',
      environment: 'sandbox',
      accessAuthorizationUrl: 'https://access.example.com/authorize',
      sessionEncryptionKey: 'synthetic-session-key-for-alert-tests',
    });
    const failingDb = {
      prepare: fixture.db.prepare.bind(fixture.db),
      batch: async () => { throw new Error('synthetic commit failure'); },
    } as unknown as D1Database;
    await expect(ingestAlertBatch(failingDb, capture, { events: [event()] })).rejects.toThrow('synthetic commit failure');
    await expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM alert_events').all()).resolves.toMatchObject({ results: [{ count: 0 }] });
    await expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM transactions').all()).resolves.toMatchObject({ results: [{ count: 0 }] });
  });
});

