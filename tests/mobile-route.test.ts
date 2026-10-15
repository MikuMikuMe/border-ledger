import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import { createAlertFixture, event, mobileEnv, postAlerts, CAPTURE_SECRET } from './helpers/alerts';

describe('mobile alert route guards', () => {
  it('does not let a device bearer fall through to the legacy API-key route', async () => {
    const fixture = await createAlertFixture();
    const response = await worker.fetch(new Request('https://pf.example.com/api/mobile/v1/alerts', {
      method: 'POST',
      headers: { authorization: 'Bearer legacy-key', 'content-type': 'application/json' },
      body: JSON.stringify({ events: [event()] }),
    }), mobileEnv(fixture.db) as never);
    expect(response.status).toBe(401);
    expect(await fixture.db.prepare('SELECT COUNT(*) AS count FROM alert_events').all()).toMatchObject({ results: [{ count: 0 }] });
  });

  it('checks the capture scope before replay lookup for an event from another account', async () => {
    const fixture = await createAlertFixture({ secondAccount: true });
    const first = await postAlerts(fixture.db, [event()]);
    expect(first.status).toBe(200);
    const outOfScope = await postAlerts(fixture.db, [event({ eventMoney: { currency: 'USD', amountMinor: 1234 }, amounts: [{ role: 'transaction', currency: 'USD', amountMinor: 1234 }] })]);
    expect(await outOfScope.json()).toMatchObject({ acks: [{ status: 'rejected', projectionState: null, reasonCodes: ['out_of_scope'] }] });
  });

  it('keeps the canonical-origin guard ahead of mobile route dispatch', async () => {
    const fixture = await createAlertFixture();
    const response = await worker.fetch(new Request('https://border-ledger.workers.dev/api/mobile/v1/status', { headers: { authorization: `Bearer ${CAPTURE_SECRET}` } }), mobileEnv(fixture.db) as never);
    expect(response.status).toBe(404);
  });

  it('rejects malformed status eventId query values before lookup', async () => {
    const fixture = await createAlertFixture();
    const response = await worker.fetch(new Request('https://pf.example.com/api/mobile/v1/status?eventId=00000000-0000-4000-0000-000000000001', { headers: { authorization: `Bearer ${CAPTURE_SECRET}` } }), mobileEnv(fixture.db) as never);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'invalid_request' });
  });
});

