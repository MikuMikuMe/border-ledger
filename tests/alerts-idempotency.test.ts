import { describe, expect, it } from 'vitest';
import { createAlertFixture, event, postAlerts, CAPTURE_SECRET } from './helpers/alerts';
import { hashSecret } from '../worker/mobile-auth';

describe('mobile alert idempotency', () => {
  it('returns the same receipt and projection identity for duplicate and renewed-credential retries', async () => {
    const fixture = await createAlertFixture();
    const first = await postAlerts(fixture.db, [event()]);
    const duplicate = await postAlerts(fixture.db, [event()]);
    const renewedSecret = 'capture-secret-alert-tests-renewed';
    await fixture.db.prepare('INSERT INTO capture_credentials (id, device_id, credential_hash, credential_type, scope, generation, issued_at, expires_at, environment_hash, revocation_capability_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind('capture-credential-renewed', 'capture-device', await hashSecret(renewedSecret), 'capture', 'alerts:write', 2, '2026-10-13T00:00:00.000Z', '2027-01-11T00:00:00.000Z', await hashSecret('sandbox'), 'synthetic-revocation-hash-2').run();
    const renewed = await postAlerts(fixture.db, [event()], renewedSecret);

    const firstAck = (await first.json() as { acks: Array<Record<string, unknown>> }).acks[0];
    expect((await duplicate.json() as { acks: Array<Record<string, unknown>> }).acks[0]).toEqual({ ...firstAck, status: 'replayed' });
    expect((await renewed.json() as { acks: Array<Record<string, unknown>> }).acks[0]).toEqual({ ...firstAck, status: 'replayed' });
    await expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM transactions').all()).resolves.toMatchObject({ results: [{ count: 1 }] });
  });

  it('serializes concurrent retries to one evidence row and one counted projection', async () => {
    const fixture = await createAlertFixture();
    const [first, second] = await Promise.all([postAlerts(fixture.db, [event()]), postAlerts(fixture.db, [event()])]);
    const statuses = [((await first.json()) as { acks: Array<{ status: string }> }).acks[0].status, ((await second.json()) as { acks: Array<{ status: string }> }).acks[0].status].sort();
    expect(statuses).toEqual(['accepted', 'replayed']);
    await expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM alert_events').all()).resolves.toMatchObject({ results: [{ count: 1 }] });
    await expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM alert_projections').all()).resolves.toMatchObject({ results: [{ count: 1 }] });
  });

  it('returns conflict for changed content under one event UUID without mutating the original', async () => {
    const fixture = await createAlertFixture();
    await expect(postAlerts(fixture.db, [event()])).resolves.toMatchObject({ status: 200 });
    const response = await postAlerts(fixture.db, [event({ merchant: 'Changed merchant' })]);
    expect(await response.json()).toMatchObject({ acks: [{ status: 'conflict', receiptId: null, reasonCodes: ['idempotency_conflict'] }] });
    await expect(fixture.db.prepare('SELECT merchant FROM alert_events WHERE event_id = ?').bind(event().eventId).all()).resolves.toMatchObject({ results: [{ merchant: 'Synthetic merchant' }] });
    await expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM transactions').all()).resolves.toMatchObject({ results: [{ count: 1 }] });
  });

  it('allows a lost-response receipt to be recovered through the scoped status route', async () => {
    const fixture = await createAlertFixture();
    await postAlerts(fixture.db, [event()]);
    const worker = (await import('../worker/index')).default;
    const response = await worker.fetch(new Request(`https://pf.example.com/api/mobile/v1/status?eventId=${encodeURIComponent(event().eventId)}`, { headers: { authorization: `Bearer ${CAPTURE_SECRET}` } }), {
      DB: fixture.db,
      LEDGER_APP_ORIGIN: 'https://pf.example.com',
      MOBILE_ENVIRONMENT: 'sandbox',
      MOBILE_ACCESS_AUTHORIZATION_URL: 'https://access.example.com/authorize',
      MOBILE_SESSION_ENCRYPTION_KEY: 'synthetic-session-key-for-alert-tests',
    } as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ receipt: { eventId: event().eventId, status: 'replayed', receiptId: event().eventId } });
  });

  it('returns ISO-normalized RFC3339 status timestamps', async () => {
    const fixture = await createAlertFixture();
    await fixture.db.prepare('UPDATE capture_credentials SET expires_at = ? WHERE id = ?')
      .bind('2027-01-11T00:00:00+00:00', 'capture-credential').run();
    await postAlerts(fixture.db, [event()]);
    const worker = (await import('../worker/index')).default;
    const response = await worker.fetch(new Request(`https://pf.example.com/api/mobile/v1/status?eventId=${encodeURIComponent(event().eventId)}`, { headers: { authorization: `Bearer ${CAPTURE_SECRET}` } }), {
      DB: fixture.db,
      LEDGER_APP_ORIGIN: 'https://pf.example.com',
      MOBILE_ENVIRONMENT: 'sandbox',
      MOBILE_ACCESS_AUTHORIZATION_URL: 'https://access.example.com/authorize',
      MOBILE_SESSION_ENCRYPTION_KEY: 'synthetic-session-key-for-alert-tests',
    } as never);
    const body = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(['credentialExpiresAt', 'deviceId', 'ingestionState', 'lastAcceptedAt', 'receipt']);
    expect(body.credentialExpiresAt).toBe('2027-01-11T00:00:00.000Z');
    expect(body.lastAcceptedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Date.parse(body.lastAcceptedAt as string)).not.toBeNaN();
    expect(body.receipt).toMatchObject({ eventId: event().eventId, status: 'replayed', receiptId: event().eventId });
  });

  it.each([
    '2027-01-11',
    '2027-01-11T00:00:00',
    '2027-02-30T00:00:00.000Z',
  ])('rejects a capture credential expiry that is not a valid RFC3339 instant: %s', async (expiresAt) => {
    const fixture = await createAlertFixture();
    await fixture.db.prepare('UPDATE capture_credentials SET expires_at = ? WHERE id = ?').bind(expiresAt, 'capture-credential').run();
    const worker = (await import('../worker/index')).default;
    const response = await worker.fetch(new Request('https://pf.example.com/api/mobile/v1/status', { headers: { authorization: `Bearer ${CAPTURE_SECRET}` } }), {
      DB: fixture.db,
      LEDGER_APP_ORIGIN: 'https://pf.example.com',
      MOBILE_ENVIRONMENT: 'sandbox',
      MOBILE_ACCESS_AUTHORIZATION_URL: 'https://access.example.com/authorize',
      MOBILE_SESSION_ENCRYPTION_KEY: 'synthetic-session-key-for-alert-tests',
    } as never);

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'expired' });
  });

  it('rejects a status eventId that is not the v4 UUID format used by alert events', async () => {
    const fixture = await createAlertFixture();
    const worker = (await import('../worker/index')).default;
    const response = await worker.fetch(new Request('https://pf.example.com/api/mobile/v1/status?eventId=00000000-0000-4000-0000-000000000001', { headers: { authorization: `Bearer ${CAPTURE_SECRET}` } }), {
      DB: fixture.db,
      LEDGER_APP_ORIGIN: 'https://pf.example.com',
      MOBILE_ENVIRONMENT: 'sandbox',
      MOBILE_ACCESS_AUTHORIZATION_URL: 'https://access.example.com/authorize',
      MOBILE_SESSION_ENCRYPTION_KEY: 'synthetic-session-key-for-alert-tests',
    } as never);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'invalid_request' });
  });

  it('does not expose one device receipt to another device with the same approved scope', async () => {
    const fixture = await createAlertFixture();
    const otherSecret = 'capture-secret-alert-tests-other-device';
    await fixture.db.batch([
      fixture.db.prepare('INSERT INTO mobile_devices (id, ledger_id, device_name, platform, status) VALUES (?, ?, ?, ?, ?)')
        .bind('capture-device-2', 'personal', 'Synthetic second capture phone', 'android', 'paired'),
      fixture.db.prepare('INSERT INTO capture_credentials (id, device_id, credential_hash, credential_type, scope, generation, issued_at, expires_at, environment_hash, revocation_capability_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind('capture-credential-2', 'capture-device-2', await hashSecret(otherSecret), 'capture', 'alerts:write', 1, '2026-10-13T00:00:00.000Z', '2027-01-11T00:00:00.000Z', await hashSecret('sandbox'), 'synthetic-revocation-hash-2'),
      fixture.db.prepare('INSERT INTO device_source_scopes (id, device_id, source_profile_id, account_id, currency, status) VALUES (?, ?, ?, ?, ?, ?)')
        .bind('capture-scope-cad-2', 'capture-device-2', 'source-boc', 'account-boc', 'CAD', 'approved'),
    ]);
    await postAlerts(fixture.db, [event()]);
    const worker = (await import('../worker/index')).default;
    const status = await worker.fetch(new Request(`https://pf.example.com/api/mobile/v1/status?eventId=${encodeURIComponent(event().eventId)}`, { headers: { authorization: `Bearer ${otherSecret}` } }), {
      DB: fixture.db,
      LEDGER_APP_ORIGIN: 'https://pf.example.com',
      MOBILE_ENVIRONMENT: 'sandbox',
      MOBILE_ACCESS_AUTHORIZATION_URL: 'https://access.example.com/authorize',
      MOBILE_SESSION_ENCRYPTION_KEY: 'synthetic-session-key-for-alert-tests',
    } as never);
    expect(await status.json()).toMatchObject({ deviceId: 'capture-device-2', receipt: null, lastAcceptedAt: null });

    const retry = await postAlerts(fixture.db, [event()], otherSecret);
    expect(await retry.json()).toMatchObject({ acks: [{ status: 'conflict', receiptId: null, reasonCodes: ['idempotency_conflict'] }] });
  });
});

