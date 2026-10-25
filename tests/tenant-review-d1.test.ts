import { expect, it } from 'vitest';
import { createD1Fixture, task24MigrationNames } from './helpers/d1';
import { seedRouteTenants, routeRequest, callRoute } from './helpers/tenant-routes';
import { event } from './helpers/alerts';
import type { D1Database } from '../worker/db-types';

async function reviewFixture(resolved=false) {
  const fixture=await createD1Fixture(task24MigrationNames);
  const route=await seedRouteTenants(fixture.db);
  for(const user of ['owner','second']) {
    const response=await callRoute(route.env,routeRequest('/api/mobile/v1/alerts',{token:`capture-${user}`},'POST',{
      events:[event({sourceProfileId:`${user}-profile`,parserVersion:'v1',
        ...(resolved?{}:{eventTimeBasis:'unresolved',notificationPostedAt:null}),
      })],
    }));
    expect(response.status,await response.clone().text()).toBe(200);
  }
  return {...fixture,...route};
}

it.each(['revision','revoke'] as const)('atomically rejects a native HTTP review after a D1 %s race',async change=>{
  const fixture=await reviewFixture();
  try {
    const before=(await fixture.db.prepare('SELECT * FROM transactions ORDER BY id').all()).results;
    const racing:D1Database={prepare:fixture.db.prepare.bind(fixture.db),batch:async statements=>{
      await fixture.db.prepare(change==='revision'
        ? "UPDATE alert_projections SET revision=2 WHERE ledger_id='second-ledger'"
        : "UPDATE owner_session_families SET revoked_at=CURRENT_TIMESTAMP WHERE id='second-family'").run();
      return fixture.db.batch(statements);
    }};
    const response=await callRoute({...fixture.env,DB:racing},routeRequest(`/api/mobile/v1/alerts/${event().eventId}/review`,
      {token:fixture.tokens.get('second')!},'PATCH',{expectedRevision:1,decision:'ignore'}));
    expect(response.status,await response.clone().text()).toBe(change==='revision'?409:403);
    const body=await response.json();
    if(change==='revision')expect(body).toMatchObject({currentRevision:2});
    else expect(body).not.toHaveProperty('currentRevision');
    expect((await fixture.db.prepare('SELECT * FROM transactions ORDER BY id').all()).results).toEqual(before);
    expect(await fixture.db.prepare("SELECT COUNT(*) AS n FROM alert_projection_provenance WHERE source_kind='review'").first()).toEqual({n:0});
    expect(await fixture.db.prepare("SELECT revision FROM alert_projections WHERE ledger_id='personal'").first()).toEqual({revision:1});
  } finally {await fixture.dispose();}
});

it('rolls back a lifecycle link, target amount and source revision together after a native D1 race',async()=>{
  const fixture=await reviewFixture(true);
  try {
    const reversalId='00000000-0000-4000-8000-000000000002';
    const captured=await callRoute(fixture.env,routeRequest('/api/mobile/v1/alerts',{token:'capture-second'},'POST',{
      events:[event({eventId:reversalId,observationId:'reversal',sourceProfileId:'second-profile',parserVersion:'v1',
        eventType:'authorization_reversal',direction:'none',eventMoney:{currency:'CAD',amountMinor:500},
        amounts:[{role:'transaction',currency:'CAD',amountMinor:500}],
      })],
    }));
    expect(captured.status).toBe(200);
    const before=(await fixture.db.prepare('SELECT * FROM transactions ORDER BY id').all()).results;
    const racing:D1Database={prepare:fixture.db.prepare.bind(fixture.db),batch:async statements=>{
      await fixture.db.prepare("UPDATE alert_projections SET revision=2 WHERE ledger_id='second-ledger' AND transaction_id IS NOT NULL").run();
      return fixture.db.batch(statements);
    }};
    const response=await callRoute({...fixture.env,DB:racing},routeRequest(`/api/mobile/v1/alerts/${reversalId}/review`,
      {token:fixture.tokens.get('second')!},'PATCH',{expectedRevision:1,decision:'link',relation:'partially_reverses',
        targetId:event().eventId,allocatedMoney:{currency:'CAD',amountMinor:500},
      }));
    expect(response.status,await response.clone().text()).toBe(409);
    expect((await fixture.db.prepare('SELECT * FROM transactions ORDER BY id').all()).results).toEqual(before);
    expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM alert_event_links').first()).toEqual({n:0});
    expect(await fixture.db.prepare("SELECT revision FROM alert_projections p JOIN alert_events e ON e.id=p.event_id AND e.ledger_id=p.ledger_id WHERE p.ledger_id='second-ledger' AND e.raw_event_id=?")
      .bind(reversalId).first()).toEqual({revision:1});
  } finally {await fixture.dispose();}
});

it('denies HTTP review at execution-time expiry without changing the family row during the wait',async()=>{
  const fixture=await reviewFixture();
  try {
    await fixture.db.prepare("UPDATE owner_session_families SET access_expires_at=? WHERE id='second-family'")
      .bind(new Date(Date.now()+1000).toISOString()).run();
    const before=(await fixture.db.prepare("SELECT * FROM owner_session_families WHERE id='second-family'").first());
    const delayed:D1Database={prepare:fixture.db.prepare.bind(fixture.db),batch:async statements=>{
      await new Promise(resolve=>setTimeout(resolve,1200));return fixture.db.batch(statements);
    }};
    const response=await callRoute({...fixture.env,DB:delayed},routeRequest(`/api/mobile/v1/alerts/${event().eventId}/review`,
      {token:fixture.tokens.get('second')!},'PATCH',{expectedRevision:1,decision:'ignore'}));
    expect(response.status,await response.clone().text()).toBe(403);
    expect(await response.json()).not.toHaveProperty('currentRevision');
    expect(await fixture.db.prepare("SELECT * FROM owner_session_families WHERE id='second-family'").first()).toEqual(before);
    expect(await fixture.db.prepare("SELECT revision FROM alert_projections WHERE ledger_id='second-ledger'").first()).toEqual({revision:1});
  } finally {await fixture.dispose();}
});
