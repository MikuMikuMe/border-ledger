import { describe, expect, it } from 'vitest';
import { provisionWebOwner, VERIFIED_WEB_ENV, VERIFIED_WEB_HEADERS } from './helpers/web-identity';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { seedTenants } from './helpers/tenants';
import worker from '../worker/index';

async function request(db: import('../worker/db-types').D1Database, path: string, body?: unknown) {
  return worker.fetch(new Request(`https://pf.example.com${path}`, {method:body ? 'POST':'GET',
    headers:{...VERIFIED_WEB_HEADERS,origin:'https://pf.example.com','content-type':'application/json'},
    body:body ? JSON.stringify(body):undefined}), {...VERIFIED_WEB_ENV,DB:db,LEDGER_APP_ORIGIN:'https://pf.example.com',
      ASSETS:{fetch:async()=>new Response('not found',{status:404})}} as never);
}

describe('core routes with multiple stored tenants', () => {
  it.each([
    ['/api/accounts','accounts',['owner-account']],
    ['/api/transactions','transactions',['owner-tx-1','owner-tx-2']],
  ])('scopes %s through the verified web context', async (path, key, ids) => {
    const fixture = createSqliteD1Fixture();
    try {
      await seedTenants(fixture.db); await provisionWebOwner(fixture.db);
      const response = await request(fixture.db, path as string);
      expect(response.status).toBe(200);
      const body = await response.json() as Record<string,Array<{id:string}>>;
      expect(body[key as string].map(row=>row.id).sort()).toEqual(ids);
    } finally {fixture.close();}
  });
  it('aggregates only the authenticated web ledger', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await seedTenants(fixture.db); await provisionWebOwner(fixture.db);
      const response = await request(fixture.db, '/api/reports/summary');
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ledgerId:'personal',summary:{CAD:200},transactionCount:2});
    } finally {fixture.close();}
  });
  it('rejects a guessed foreign account on the actual statement commit route', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await seedTenants(fixture.db); await provisionWebOwner(fixture.db);
      const response = await request(fixture.db, '/api/imports/commit', {accountId:'second-account',filename:'bank.csv',fileSha256:'a'.repeat(64),operationId:'guessed',
        transactions:[{id:'guessed-row',accountId:'second-account',date:'2026-10-23',merchant:'Cafe',amountMinor:-100,currency:'CAD',category:'Food',kind:'expense',status:'confirmed',source:'statement',fingerprint:'guess'}]});
      expect(response.status).toBe(400);
      expect(await fixture.db.prepare('SELECT COUNT(*) AS count FROM imports').first('count')).toBe(0);
      expect(await fixture.db.prepare("SELECT COUNT(*) AS count FROM transactions WHERE ledger_id='second-ledger'").first('count')).toBe(2);
    } finally {fixture.close();}
  });
});
