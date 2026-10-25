import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';

vi.mock('jose', async (original) => {
  const actual = await original<typeof import('jose')>();
  return { ...actual, jwtVerify: async (assertion: string) => ({ payload: { sub: assertion, iss: 'https://access.example.com', aud: 'tenant-audience' } }) };
});
const env = { ACCESS_TEAM_DOMAIN: 'https://access.example.com', ACCESS_AUDIENCE: 'tenant-audience', LEDGER_APP_ORIGIN: 'https://pf.example.com', LEDGER_API_KEY: 'legacy-key', ASSETS: { fetch: async () => new Response('not found', { status: 404 }) } };
const fixtures: ReturnType<typeof createSqliteD1Fixture>[] = [];
afterEach(() => { while (fixtures.length) fixtures.pop()!.close(); });
function fixture() { const value = createSqliteD1Fixture(); fixtures.push(value); return value; }

describe('closed-registration web authentication', () => {
  it('rejects the legacy global key before reading ledger data while health stays public', async () => {
    const { db } = fixture();
    const response = await worker.fetch(new Request('https://pf.example.com/api/accounts', { headers: { authorization: 'Bearer legacy-key' } }), { ...env, DB: db } as never);
    expect(response.status).toBe(401);
    expect((await worker.fetch(new Request('https://pf.example.com/api/health'), { ...env, DB: db } as never)).status).toBe(200);
  });
  it('rejects unknown and disabled verified identities without enrolling them', async () => {
    const { db } = fixture();
    await db.prepare("INSERT INTO user_identities(issuer,subject,user_id) VALUES ('https://access.example.com','known','owner')").run();
    const request = (subject: string) => new Request('https://pf.example.com/api/accounts', { headers: { 'Cf-Access-Jwt-Assertion': subject } });
    expect((await worker.fetch(request('unknown'), { ...env, DB: db } as never)).status).toBe(403);
    await db.prepare("UPDATE users SET status = 'disabled' WHERE id = 'owner'").run();
    expect((await worker.fetch(request('known'), { ...env, DB: db } as never)).status).toBe(403);
    expect(await db.prepare('SELECT COUNT(*) FROM users').first('COUNT(*)')).toBe(1);
    expect(await db.prepare('SELECT COUNT(*) FROM user_identities').first('COUNT(*)')).toBe(1);
  });
  it('serves only the second provisioned ledger after runtime scoping', async () => {
    const { db } = fixture();
    await db.batch([db.prepare("INSERT INTO users(id) VALUES ('second')"), db.prepare("INSERT INTO ledgers(id,user_id) VALUES ('second-ledger','second')"), db.prepare("INSERT INTO user_identities(issuer,subject,user_id) VALUES ('https://access.example.com','second','second')")]);
    const response = await worker.fetch(new Request('https://pf.example.com/api/accounts', { headers: { 'Cf-Access-Jwt-Assertion': 'second' } }), { ...env, DB: db } as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accounts: [] });
  });
});
