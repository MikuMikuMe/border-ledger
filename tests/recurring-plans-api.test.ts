import { VERIFIED_WEB_ENV, VERIFIED_WEB_HEADERS, provisionWebOwner } from './helpers/web-identity';
import { afterEach, describe, expect, it } from 'vitest';
import worker from '../worker/index';
import { createD1Fixture, task24MigrationNames } from './helpers/d1';
const fixtures: Array<{dispose():Promise<void>}> = [];
afterEach(async () => { while (fixtures.length) await fixtures.pop()!.dispose(); });
describe('recurring plan web API', () => {
  it('requires authentication and supports scoped create, read and revision-checked edits', async () => {
    const f = await createD1Fixture([...task24MigrationNames, '0025-lunchflow-platform.sql', '0026-lunchflow-connection-mappings.sql', '0027-hosted-users-activation.sql', '0028-recurring-plans.sql']); fixtures.push(f);
    await provisionWebOwner(f.db);
    await f.db.prepare("INSERT INTO accounts(id,name,institution,currency,kind,status,ledger_id) VALUES('acct','Account','Bank','CAD','chequing','connected','personal')").run();
    const env = { DB: f.db, ...VERIFIED_WEB_ENV, LEDGER_APP_ORIGIN: 'https://pf.example.com', ASSETS: { fetch: async () => new Response('not found', { status: 404 }) } };
    const url = 'https://pf.example.com/api/recurring-plans';
    expect((await worker.fetch(new Request(url), env as never)).status).toBe(401);
    const body = { operationId: 'request-1', plan: { accountId: 'acct', currency: 'CAD', merchant: 'Transit', direction: 'expense', amountMinor: 1250, frequency: 'monthly', startDate: '2026-01-31', endDate: null } };
    const headers = { ...VERIFIED_WEB_HEADERS, origin: 'https://pf.example.com', 'content-type': 'application/json' };
    const create = await worker.fetch(new Request(url, { method: 'POST', headers, body: JSON.stringify(body) }), env as never);
    expect(create.status).toBe(201);
    const created = await create.json() as {id:string};
    const read = await worker.fetch(new Request(url, {headers: VERIFIED_WEB_HEADERS}), env as never);
    expect(await read.json()).toMatchObject({ plans: [{ id: created.id }], accountCurrencies: [{ accountId: 'acct', currency: 'CAD' }] });
    const edit = await worker.fetch(new Request(`${url}/${created.id}`, { method: 'PATCH', headers, body: JSON.stringify({ expectedRevision: 0, plan: { ...body.plan, enabled: false } }) }), env as never);
    expect(edit.status).toBe(200);
    const conflict = await worker.fetch(new Request(`${url}/${created.id}`, { method: 'PATCH', headers, body: JSON.stringify({ expectedRevision: 0, plan: { ...body.plan, enabled: false } }) }), env as never);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({currentRevision:1});
  });
});
