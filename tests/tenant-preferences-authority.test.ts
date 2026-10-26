import { afterEach, expect, it, vi } from 'vitest';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { seedRouteTenants, routeRequest, callRoute } from './helpers/tenant-routes';
import type { D1Database, D1Statement } from '../worker/db-types';
vi.mock('jose', async original => ({ ...await original<typeof import('jose')>(), jwtVerify: async () => ({ payload: { sub: 'second-subject', iss: 'https://access.example.com', aud: 'tenant-route-audience' } }) }));
const fixtures: ReturnType<typeof createSqliteD1Fixture>[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const fixture of fixtures.splice(0)) fixture.close(); });
async function setup() {
  const fixture = createSqliteD1Fixture(); fixtures.push(fixture);
  return { db: fixture.db, ...await seedRouteTenants(fixture.db) };
}
const changes = {
  revoked: "UPDATE owner_session_families SET revoked_at=CURRENT_TIMESTAMP WHERE id='second-family'",
  disabled: "UPDATE users SET status='disabled' WHERE id='second'",
  expired: "UPDATE owner_session_families SET access_expires_at='2000-01-01T00:00:00Z' WHERE id='second-family'",
  generation: "UPDATE owner_session_families SET access_generation=2 WHERE id='second-family'",
  scope: "UPDATE owner_session_families SET scope_json='[\"ledger:read\"]' WHERE id='second-family'",
  environment: "UPDATE owner_session_families SET environment_hash='changed' WHERE id='second-family'",
};
function interceptStatement(statement: D1Statement, hooks: { beforeRun(): Promise<void>; afterRead(): Promise<void> }): D1Statement {
  return {
    bind(...values: unknown[]) { statement.bind(...values); return this; },
    first: statement.first.bind(statement),
    async run() { await hooks.beforeRun(); return statement.run(); },
    async all<T>() { const result = await statement.all<T>(); await hooks.afterRead(); return result; },
  };
}
function racingDatabase(db: D1Database, point: 'currency' | 'update' | 'disclosure', change: string) {
  let fired = false;
  const intervene = async () => { if (!fired) { fired = true; await db.prepare(change).run(); } };
  const prepare = (sql: string): D1Statement => interceptStatement(db.prepare(sql), {
    async beforeRun() { if (point === 'update' && sql.startsWith('UPDATE ledger_preferences')) await intervene(); },
    async afterRead() {
      const matched = point === 'currency' ? sql.startsWith('SELECT code FROM currencies') : point === 'disclosure' && sql.includes('FROM ledger_preferences WHERE');
      if (matched) await intervene();
    },
  });
  return { db: { prepare, batch: db.batch.bind(db) }, fired: () => fired };
}
const body = { expectedRevision: 0, reportingTimezone: 'Asia/Shanghai', weekStart: 0, preferredCurrency: 'CAD' };
async function patch(env: Awaited<ReturnType<typeof setup>>['env'], token: string, input = body, web = false) {
  const request = routeRequest(web ? '/api/preferences' : '/api/mobile/v1/preferences', web ? { web: 'second-subject' } : { token }, 'PATCH', input);
  request.headers.set('X-Ledger-Protocol', '2');
  return callRoute(env, request);
}
it.each(Object.keys(changes) as Array<keyof typeof changes>)('rejects %s after the currency await without publication or revision disclosure', async change => {
  const { db, env, tokens } = await setup(); const before = await db.prepare("SELECT * FROM ledger_preferences WHERE ledger_id='second-ledger'").first();
  const race = racingDatabase(db, 'currency', changes[change]);
  const response = await patch({ ...env, DB: race.db }, tokens.get('second')!);
  expect(race.fired()).toBe(true); expect(response.status).toBe(403);
  const result = await response.json(); expect(result).not.toHaveProperty('currentRevision'); expect(result).not.toHaveProperty('reportingTimezone');
  expect(await db.prepare("SELECT * FROM ledger_preferences WHERE ledger_id='second-ledger'").first()).toEqual(before);
});
it('keeps the authority predicate on the actual SQL update boundary', async () => {
  const { db, env, tokens } = await setup(); const race = racingDatabase(db, 'update', changes.revoked);
  expect((await patch({ ...env, DB: race.db }, tokens.get('second')!)).status).toBe(403);
  expect(race.fired()).toBe(true);
  expect(await db.prepare("SELECT revision FROM ledger_preferences WHERE ledger_id='second-ledger'").first()).toEqual({ revision: 0 });
});
it('rejects disabled web authority after initial identity resolution', async () => {
  const { db, env } = await setup(); const race = racingDatabase(db, 'currency', changes.disabled);
  expect((await patch({ ...env, DB: race.db }, '', body, true)).status).toBe(403);
  expect(await db.prepare("SELECT revision FROM ledger_preferences WHERE ledger_id='second-ledger'").first()).toEqual({ revision: 0 });
});
it.each([0, 99])('revalidates before success/conflict disclosure for requested revision %s', async expectedRevision => {
  const { db, env, tokens } = await setup(); const race = racingDatabase(db, 'disclosure', changes.revoked);
  const response = await patch({ ...env, DB: race.db }, tokens.get('second')!, { ...body, expectedRevision });
  expect(race.fired()).toBe(true); expect(response.status).toBe(403);
  const result = await response.json(); expect(result).not.toHaveProperty('currentRevision'); expect(result).not.toHaveProperty('reportingTimezone');
});
it('preserves valid updates and genuine same-user optimistic conflicts', async () => {
  const { db, env, tokens } = await setup();
  const updated = await patch(env, tokens.get('second')!); expect(updated.status).toBe(200);
  expect(await updated.json()).toMatchObject({ revision: 1, reportingTimezone: 'Asia/Shanghai' });
  const conflict = await patch(env, tokens.get('second')!); expect(conflict.status).toBe(409);
  expect(await conflict.json()).toMatchObject({ currentRevision: 1 });
  expect(await db.prepare("SELECT revision FROM ledger_preferences WHERE ledger_id='personal'").first()).toEqual({ revision: 0 });
});
