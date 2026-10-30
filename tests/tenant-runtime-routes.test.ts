import { afterEach, expect, it, vi } from 'vitest';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { seedRouteTenants, routeRequest, callRoute } from './helpers/tenant-routes';
import { event } from './helpers/alerts';

vi.mock('jose',async(original)=>{
  const actual=await original<typeof import('jose')>();
  return {...actual,jwtVerify:async(assertion:string)=>{
    if (!['owner-subject','second-subject','unknown-subject'].includes(assertion)) throw new Error('Invalid assertion');
    return {payload:{sub:assertion,iss:'https://access.example.com',aud:'tenant-route-audience'}};
  }};
});
const fixtures:ReturnType<typeof createSqliteD1Fixture>[]=[];
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();for(const fixture of fixtures.splice(0))fixture.close();});
async function setup(){const fixture=createSqliteD1Fixture();fixtures.push(fixture);return {db:fixture.db,...await seedRouteTenants(fixture.db)};}

function importRow(user:string) {
  return {id:'shared-row',rowId:'shared-row',rowIndex:0,accountId:`${user}-account`,date:'2026-10-24',merchant:'Imported cafe',
    amountMinor:-321,currency:'CAD',category:'Food',kind:'expense',status:'confirmed',source:'statement',fingerprint:'same-fingerprint'};
}
async function responseJson<T>(response:Response,status:number):Promise<T> {
  expect(response.status,await response.clone().text()).toBe(status);
  return response.json() as Promise<T>;
}

it('runs web commit/replay and native preview/chunk/commit/replay/cancel with equal raw operation IDs',async()=>{
  const {env,tokens}=await setup();
  const previews=new Map<string,string>();
  for(const user of ['owner','second']) {
    const web={web:`${user}-subject`};const native={token:tokens.get(user)!};
    const body={operationId:'same-web-operation',accountId:`${user}-account`,filename:'web.csv',fileSha256:'a'.repeat(64),transactions:[importRow(user)]};
    await responseJson(await callRoute(env,routeRequest('/api/imports/commit',web,'POST',body)),201);
    await responseJson(await callRoute(env,routeRequest('/api/imports/commit',web,'POST',body)),200);
    const previewBody={accountId:`${user}-account`,fileName:'native.csv',fileSizeBytes:100,fileSha256:'b'.repeat(64),format:'csv',rowCount:1};
    const preview=await responseJson<{id:string;revision:number}>(await callRoute(env,routeRequest('/api/mobile/v1/imports/previews',native,'POST',previewBody,'same-preview')),201);
    previews.set(user,preview.id);
    const staged=await responseJson<{revision:number}>(await callRoute(env,routeRequest(`/api/mobile/v1/imports/${preview.id}/chunks/0`,native,'PUT',{
      rowStart:0,rows:[{...importRow(user),amountMinor:-432}]},'same-chunk')),200);
    const commit={expectedRevision:staged.revision,rowIds:['shared-row']};
    const result=await responseJson<{acceptedCount:number}>(await callRoute(env,routeRequest(`/api/mobile/v1/imports/${preview.id}/commit`,native,'POST',commit,'same-commit')),200);
    expect(result).toHaveProperty('receiptId');
    await responseJson(await callRoute(env,routeRequest(`/api/mobile/v1/imports/${preview.id}/commit`,native,'POST',commit,'same-commit')),200);
    const cancel=await responseJson<{id:string;revision:number}>(await callRoute(env,routeRequest('/api/mobile/v1/imports/previews',native,'POST',{
      ...previewBody,fileSha256:'c'.repeat(64)},'same-cancel-preview')),201);
    await responseJson(await callRoute(env,routeRequest(`/api/mobile/v1/imports/${cancel.id}`,native,'DELETE',{expectedRevision:cancel.revision})),200);
  }
  expect(previews.get('owner')).not.toBe(previews.get('second'));
  const foreign=await callRoute(env,routeRequest(`/api/mobile/v1/imports/${previews.get('owner')}/chunks/0`,{token:tokens.get('second')!},'PUT',{
    rowStart:0,rows:[importRow('second')]},'foreign-chunk'));
  expect(foreign.status).toBe(404);
});

it('isolates web and native provider bindings, selected accounts, sync and disconnect routes',async()=>{
  const {db,env,tokens}=await setup();const messages:unknown[]=[];
  const providerEnv={...env,PLAID_CLIENT_ID:'synthetic-client',PLAID_SECRET:'synthetic-secret',PLAID_ENV:'sandbox',
    PLAID_ENCRYPTION_KEY:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',SYNC_QUEUE:{send:async(value:unknown)=>{messages.push(value);}}};
  const requests:Array<{path:string;body:Record<string,unknown>}>=[];
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const path=new URL(input instanceof Request?input.url:String(input)).pathname;
    const body=JSON.parse(input instanceof Request?await input.text():String(init?.body??'{}')) as Record<string,unknown>;requests.push({path,body});
    const responses:Record<string,unknown>={
      '/link/token/create':{link_token:'synthetic-link'},'/item/public_token/exchange':{access_token:'synthetic-token',item_id:'same-item'},
      '/item/get':{item:{item_id:'same-item',institution_name:'Bank'}},
      '/accounts/get':{accounts:[{account_id:'same-account',name:'Bank',type:'depository',subtype:'checking',balances:{iso_currency_code:'CAD'}}]},
      '/item/remove':{},
    };
    if(!(path in responses))throw new Error(`Unexpected provider request ${path}`);
    return Response.json(responses[path]);
  }));
  const items=new Map<string,string>();
  const pending=new Map<string,string>();
  const disconnects:Request[]=[];
  for(const user of ['owner','second']) {
    const web={web:`${user}-subject`};const native={token:tokens.get(user)!};
    await responseJson(await callRoute(providerEnv,routeRequest('/api/plaid/link-token',web,'POST',{})),200);
    const exchanged=await responseJson<{itemId:string}>(await callRoute(providerEnv,routeRequest('/api/plaid/exchange',web,'POST',{publicToken:'same-token',accountIds:['same-account']})),201);
    items.set(user,exchanged.itemId);
    await responseJson(await callRoute(providerEnv,routeRequest('/api/plaid/sync',web,'POST',{itemId:exchanged.itemId,scope:'transactions'})),200);
    await responseJson(await callRoute(providerEnv,routeRequest('/api/plaid/disconnect',web,'POST',{itemId:exchanged.itemId})),200);
    await responseJson(await callRoute(providerEnv,routeRequest('/api/mobile/v1/connections/link-tokens',native,'POST',{})),200);
    const exchange=await responseJson<{pendingConnectionId:string}>(await callRoute(providerEnv,routeRequest('/api/mobile/v1/connections/exchanges',native,'POST',{publicToken:'same-token'},'same-exchange')),200);
    pending.set(user,exchange.pendingConnectionId);
    await responseJson(await callRoute(providerEnv,routeRequest(`/api/mobile/v1/connections/pending/${exchange.pendingConnectionId}/account-selection`,native,'POST',{accountIds:['same-account']},'same-selection')),200);
    await responseJson(await callRoute(providerEnv,routeRequest('/api/mobile/v1/connections/sync',native,'POST',{},'same-sync')),202);
    const connections=await responseJson<{connections:Array<{connectionId:string}>}>(await callRoute(providerEnv,routeRequest('/api/mobile/v1/connections',native)),200);
    expect(connections.connections).toHaveLength(1);
    const disconnect=routeRequest(`/api/mobile/v1/connections/${connections.connections[0].connectionId}`,native,'DELETE',undefined,'same-disconnect');
    disconnect.headers.set('x-confirm-disconnect','true');
    disconnects.push(disconnect);
  }
  expect(items.get('owner')).not.toBe(items.get('second'));expect(pending.get('owner')).not.toBe(pending.get('second'));
  expect((await db.prepare('SELECT ledger_id FROM plaid_items ORDER BY ledger_id').all()).results).toEqual([{ledger_id:'personal'},{ledger_id:'second-ledger'}]);
  const linkUsers=requests.filter(request=>request.path==='/link/token/create').map(request=>(request.body.user as {client_user_id:string}).client_user_id);
  expect(linkUsers[0]).not.toBe(linkUsers[2]);
  expect((await callRoute(providerEnv,routeRequest('/api/plaid/disconnect',{web:'second-subject'},'POST',{itemId:items.get('owner')}))).status).toBe(404);
  expect((await callRoute(providerEnv,routeRequest(`/api/mobile/v1/connections/pending/${pending.get('owner')}/account-selection`,{token:tokens.get('second')!},'POST',{accountIds:['same-account']},'foreign-selection'))).status).toBe(404);
  expect(messages.length).toBeGreaterThan(0);
  for(const disconnect of disconnects)expect((await callRoute(providerEnv,disconnect)).status).toBe(204);
  expect((await db.prepare('SELECT ledger_id FROM plaid_items').all()).results).toEqual([]);
});

function ledgerRouteMode(user:string,token:string,mode:string) {
  return mode==='web'
    ? {identity:{web:`${user}-subject`},prefix:'/api',query:'from=2026-10-01&to=2026-10-31',revision:0}
    : {identity:{token},prefix:'/api/mobile/v1',query:'startDate=2026-10-01&endDate=2026-10-31',revision:1};
}

it.each(['owner','second'])('serves isolated web and native reads, reports, preferences and exports for %s',async user=>{
  const {env,tokens}=await setup();
    const other=user==='owner'?'second':'owner';
    for(const mode of ['web','native']) {
      const {identity,prefix,query,revision}=ledgerRouteMode(user,tokens.get(user)!,mode);
      for(const path of ['/accounts','/transactions','/preferences','/recurring']) {
        const response=await callRoute(env,routeRequest(prefix+path,identity));
        expect(response.status,`${mode} ${user} ${path}: ${await response.clone().text()}`).toBe(200);
        const text=await response.text();expect(text).not.toContain(`${other}-account`);expect(text).not.toContain(`${other}-tx`);
      }
      const filter=await callRoute(env,routeRequest(`${prefix}/transactions?accountId=${other}-account`,identity));
      expect(filter.status).toBe(200);expect(await filter.text()).not.toContain(`${other}-tx`);
      const report=await callRoute(env,routeRequest(`${prefix}/reports/summary?${query}&currency=CAD`,identity));
      expect(report.status,await report.clone().text()).toBe(200);
      const update=await callRoute(env,routeRequest(`${prefix}/preferences`,identity,'PATCH',{
        expectedRevision:revision,reportingTimezone:user==='owner'?'America/Toronto':'UTC',weekStart:revision,preferredCurrency:'CAD'}));
      expect(update.status,await update.clone().text()).toBe(200);
    }
    for(const path of ['/ledger/snapshot','/exports/transactions?selection=all']) {
      const response=await callRoute(env,routeRequest(`/api/mobile/v1${path}`,{token:tokens.get(user)!}));
      expect(response.status,await response.clone().text()).toBe(200);
      const text=await response.text();expect(text).toContain(`${user}-tx-1`);expect(text).not.toContain(`${other}-tx-1`);
    }
});

it('routes equal raw capture UUIDs, owner review, annotations and devices independently',async()=>{
  const {env,tokens}=await setup();
  for(const user of ['owner','second']) {
    const identity={token:tokens.get(user)!};
    const capture={token:`capture-${user}`};
    const payload=event({sourceProfileId:`${user}-profile`,parserVersion:'v1',eventTimeBasis:'unresolved',notificationPostedAt:null});
    const accepted=await callRoute(env,routeRequest('/api/mobile/v1/alerts',capture,'POST',{events:[payload]}));
    expect(accepted.status,await accepted.clone().text()).toBe(200);
    expect(await accepted.json()).toMatchObject({acks:[{eventId:payload.eventId,receiptId:payload.eventId,status:'accepted'}]});
    const status=await callRoute(env,routeRequest(`/api/mobile/v1/status?eventId=${payload.eventId}`,capture));
    expect(status.status).toBe(200);expect(await status.json()).toMatchObject({receipt:{eventId:payload.eventId}});
    const page=await callRoute(env,routeRequest('/api/mobile/v1/alerts?limit=1',identity));
    expect(page.status,await page.clone().text()).toBe(200);
    const body=await page.json() as {items:Array<{eventId:string;transactionId:string|null}>};
    expect(body.items).toHaveLength(1);expect(body.items[0].eventId).toBe(payload.eventId);
    const reviewed=await callRoute(env,routeRequest(`/api/mobile/v1/alerts/${payload.eventId}/review`,identity,'PATCH',{expectedRevision:1,decision:'keep_separate'}));
    expect(reviewed.status,await reviewed.clone().text()).toBe(200);expect(await reviewed.json()).toMatchObject({id:payload.eventId,revision:2});
    expect(body.items[0].transactionId).toBeNull(); // Unresolved dates do not materialize a financial transaction.
    const devices=await callRoute(env,routeRequest('/api/mobile/v1/devices',identity));
    expect(devices.status).toBe(200);expect(await devices.json()).toMatchObject({devices:[{id:`${user}-device`}]});
    const foreign=await callRoute(env,routeRequest(`/api/mobile/v1/devices/${user==='owner'?'second':'owner'}-device`,identity));
    expect(foreign.status).toBe(404);
    const captureReview=await callRoute(env,routeRequest(`/api/mobile/v1/alerts/${payload.eventId}/review`,capture,'PATCH',{expectedRevision:2,decision:'ignore'}));
    expect(captureReview.status).toBe(401);
  }
});

it('does not use the owner Lunch Flow environment key for the second web or native identity',async()=>{
  const {env,tokens}=await setup();const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  for(const [prefix,identity] of [
    ['/api',{web:'second-subject'}],['/api/mobile/v1',{token:tokens.get('second')!}],
  ] as const) {
    const response=await responseJson(await callRoute({...env,LUNCHFLOW_API_KEY:'owner-only'} as typeof env,
      routeRequest(`${prefix}/lunchflow/accounts`,identity)),200);
    expect(response).toMatchObject({configured:false,accounts:[]});
  }
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(['confirms','possible_duplicate','refund_of'] as const)('publishes native %s with its revision and only caller evidence',async relation=>{
  const {db,env,tokens}=await setup();
  for(const user of ['owner','second']) {
    const native={token:tokens.get(user)!};const ledger=user==='owner'?'personal':'second-ledger';
    const payload=event({sourceProfileId:`${user}-profile`,parserVersion:'v1',
      ...(relation==='refund_of'?{eventType:'refund_notice',direction:'inflow'}:{}),
    });
    await responseJson(await callRoute(env,routeRequest('/api/mobile/v1/alerts',{token:`capture-${user}`},'POST',{events:[payload]})),200);
    const imported=await responseJson<{transactionIds:string[]}>(await callRoute(env,routeRequest('/api/imports/commit',{web:`${user}-subject`},'POST',{
      operationId:'review-target',accountId:`${user}-account`,filename:'target.csv',fileSha256:'f'.repeat(64),
      transactions:[{...importRow(user),amountMinor:-1234}],
    })),201);
    const target=imported.transactionIds[0];
    const projection=await db.prepare('SELECT transaction_id FROM alert_projections WHERE ledger_id=?').bind(ledger).first<{transaction_id:string}>();
    await db.prepare(`INSERT OR IGNORE INTO statement_reconciliation_candidates
      (id,ledger_id,source_record_id,statement_transaction_id,candidate_transaction_id,score,evidence_basis)
      SELECT ?,?,id,transaction_id,?,100,'user_review' FROM transaction_source_records
      WHERE ledger_id=? AND transaction_id=? AND source_kind='statement'`)
      .bind(`${user}-review-candidate`,ledger,projection!.transaction_id,ledger,target).run();
    const body={expectedRevision:1,decision:'link',relation,targetId:target,
      ...(relation==='refund_of'?{allocatedMoney:{currency:'CAD',amountMinor:1234}}:{}),
    };
    await responseJson(await callRoute(env,routeRequest(`/api/mobile/v1/alerts/${payload.eventId}/review`,native,'PATCH',body)),200);
    const page=await responseJson<{items:Array<{eventId:string;revision:number;links:unknown[]}>}>(await callRoute(env,routeRequest('/api/mobile/v1/alerts',native)),200);
    expect(page.items[0]).toMatchObject({eventId:payload.eventId,revision:2,links:[{relation,targetTransactionId:target}]});
  }
  expect(await db.prepare('SELECT COUNT(*) AS n FROM alert_event_links').first()).toEqual({n:2});
});

it('never enrolls unknown or disabled identities and never accepts the legacy global key',async()=>{
  const {db,env,tokens}=await setup();
  const before=(await db.prepare('SELECT * FROM users ORDER BY id').all()).results;
  const identities=(await db.prepare('SELECT * FROM user_identities ORDER BY user_id').all()).results;
  expect((await callRoute(env,routeRequest('/api/accounts',{web:'unknown-subject'}))).status).toBe(403);
  expect((await callRoute(env,routeRequest('/api/accounts',{token:'legacy-key'}))).status).toBe(401);
  expect((await db.prepare('SELECT * FROM users ORDER BY id').all()).results).toEqual(before);
  expect((await db.prepare('SELECT * FROM user_identities ORDER BY user_id').all()).results).toEqual(identities);
  await db.prepare("UPDATE users SET status='disabled' WHERE id='second'").run();
  expect((await callRoute(env,routeRequest('/api/accounts',{web:'second-subject'}))).status).toBe(403);
  expect((await callRoute(env,routeRequest('/api/mobile/v1/ledger/snapshot',{token:tokens.get('second')!}))).status).toBe(403);
  expect(await db.prepare('SELECT COUNT(*) AS n FROM owner_session_families').first()).toEqual({n:2});
});

it('rejects guessed raw review event IDs without disclosing a foreign revision',async()=>{
  const {env,tokens}=await setup();
  await responseJson(await callRoute(env,routeRequest('/api/mobile/v1/alerts',{token:'capture-owner'},'POST',{
    events:[event({sourceProfileId:'owner-profile',parserVersion:'v1'})],
  })),200);
  const response=await callRoute(env,routeRequest(`/api/mobile/v1/alerts/${event().eventId}/review`,{token:tokens.get('second')!},
    'PATCH',{expectedRevision:1,decision:'ignore'}));
  expect(response.status).toBe(404);expect(await response.json()).not.toHaveProperty('currentRevision');
});

it('keeps raw lifecycle target IDs and cursor continuity across two native ledgers',async()=>{
  const {env,tokens}=await setup();
  const purchaseId='00000000-0000-4000-8000-000000000001';
  const reversalId='00000000-0000-4000-8000-000000000002';
  const cursors=new Map<string,string>();
  for(const user of ['owner','second']) {
    const native={token:tokens.get(user)!};const capture={token:`capture-${user}`};
    const source={sourceProfileId:`${user}-profile`,parserVersion:'v1'};
    await responseJson(await callRoute(env,routeRequest('/api/mobile/v1/alerts',capture,'POST',{events:[
      event({...source,eventId:purchaseId}),
      event({...source,eventId:reversalId,observationId:'reversal',eventType:'authorization_reversal',direction:'none',
        eventMoney:{currency:'CAD',amountMinor:500},amounts:[{role:'transaction',currency:'CAD',amountMinor:500}]}),
    ]})),200);
    const first=await responseJson<{items:Array<{eventId:string}>;page:{nextCursor:string}}>(await callRoute(env,routeRequest('/api/mobile/v1/alerts?limit=1',native)),200);
    expect(first.items.map(item=>item.eventId)).toEqual([reversalId]);cursors.set(user,first.page.nextCursor);
    const next=await responseJson<{items:Array<{eventId:string}>;page:{nextCursor:null}}>(await callRoute(env,routeRequest(`/api/mobile/v1/alerts?limit=1&cursor=${first.page.nextCursor}`,native)),200);
    expect(next.items.map(item=>item.eventId)).toEqual([purchaseId]);expect(next.page.nextCursor).toBeNull();
    const reviewed=await responseJson(await callRoute(env,routeRequest(`/api/mobile/v1/alerts/${reversalId}/review`,native,'PATCH',{
      expectedRevision:1,decision:'link',relation:'partially_reverses',targetId:purchaseId,allocatedMoney:{currency:'CAD',amountMinor:500},
    })),200);
    expect(reviewed).toMatchObject({id:reversalId,revision:2});
    const page=await responseJson<{items:Array<{eventId:string;countedMoney:unknown;links:unknown[]}>}>(await callRoute(env,routeRequest('/api/mobile/v1/alerts',native)),200);
    expect(page.items.find(item=>item.eventId===reversalId)?.links).toMatchObject([{targetEventId:purchaseId,allocatedMoney:{currency:'CAD',amountMinor:500}}]);
    expect(page.items.find(item=>item.eventId===purchaseId)?.countedMoney).toEqual({currency:'CAD',amountMinor:734});
    const stale=await callRoute(env,routeRequest(`/api/mobile/v1/alerts/${reversalId}/review`,native,'PATCH',{expectedRevision:1,decision:'ignore'}));
    expect(stale.status).toBe(409);expect(await stale.json()).toMatchObject({currentRevision:2});
  }
  // A cursor is a timestamp and raw event ID, not a tenant identity. Align the timestamp
  // with the second ledger to test identical raw IDs without relying on wall-clock timing.
  const ownerCursor=JSON.parse(Buffer.from(cursors.get('owner')!,'base64url').toString('utf8')) as {createdAt:string;eventId:string};
  const secondCursor=JSON.parse(Buffer.from(cursors.get('second')!,'base64url').toString('utf8')) as {createdAt:string;eventId:string};
  expect(ownerCursor.eventId).toBe(secondCursor.eventId);
  const cursorFor=(createdAt:string)=>Buffer.from(JSON.stringify({...ownerCursor,createdAt})).toString('base64url');
  const native={token:tokens.get('second')!};
  const originalCursorPage=await responseJson<{items:Array<{sourceEvidence:{sourceProfileId:string}}> }>(await callRoute(env,routeRequest(`/api/mobile/v1/alerts?limit=1&cursor=${cursors.get('owner')}`,native)),200);
  expect(originalCursorPage.items.every(item=>item.sourceEvidence.sourceProfileId==='second-profile')).toBe(true);
  const foreignCursor=await responseJson<{items:Array<{eventId:string;sourceEvidence:{sourceProfileId:string}}> }>(await callRoute(env,routeRequest(`/api/mobile/v1/alerts?limit=1&cursor=${cursorFor(secondCursor.createdAt)}`,native)),200);
  expect(foreignCursor.items).toMatchObject([{eventId:purchaseId,sourceEvidence:{sourceProfileId:'second-profile'}}]);
  // An older cursor than every row must return an empty page.
  const older=await responseJson<{items:unknown[]}>(await callRoute(env,routeRequest(`/api/mobile/v1/alerts?limit=1&cursor=${cursorFor('2000-01-01 00:00:00')}`,native)),200);
  expect(older.items).toEqual([]);
});

it('configures and revokes each native device without accepting guessed foreign mappings',async()=>{
  const {db,env,tokens}=await setup();
  for(const user of ['owner','second']) {
    const native={token:tokens.get(user)!};const other=user==='owner'?'second':'owner';
    const mapping={sourceProfileId:`${user}-profile`,accountId:`${user}-account`,allowedCurrencies:['CAD']};
    await responseJson(await callRoute(env,routeRequest(`/api/mobile/v1/devices/${user}-device`,native)),200);
    await responseJson(await callRoute(env,routeRequest('/api/mobile/v1/devices/self/source-config',native,'PUT',{expectedRevision:0,mappings:[mapping]})),200);
    const invalid=await callRoute(env,routeRequest('/api/mobile/v1/devices/self/source-config',native,'PUT',{
      expectedRevision:1,mappings:[{...mapping,accountId:`${other}-account`}]}));
    expect(invalid.status).toBe(403);
    await responseJson(await callRoute(env,routeRequest('/api/mobile/v1/devices/self/capture-authorization',native,'POST',{
      consent:true,credentialHash:(user==='owner'?'a':'b').repeat(64),sourceConfig:{expectedRevision:1,mappings:[mapping]},
    })),200);
    const revoked=await callRoute(env,routeRequest(`/api/mobile/v1/devices/${user}-device`,native,'DELETE'));
    expect(revoked.status,await revoked.clone().text()).toBe(204);
    expect(await db.prepare('SELECT status FROM mobile_devices WHERE id=?').bind(`${user}-device`).first()).toEqual({status:'revoked'});
  }
});

it.each(['owner','second'])('serves and classifies only the recurring stream for %s through web and native routes',async user=>{
  const {db,env,tokens}=await setup();
  for(const [user,ledger] of [['owner','personal'],['second','second-ledger']]) {
    await db.prepare("INSERT INTO plaid_items(item_id,ledger_id,access_token_ciphertext,access_token_iv) VALUES (?,?,'cipher','iv')").bind(`${user}-item`,ledger).run();
    await db.prepare("INSERT INTO recurring_sync_state(item_id,ledger_id,requested_generation,scope_version,lifecycle) VALUES (?,?,1,0,'active')").bind(`${user}-item`,ledger).run();
    await db.prepare(`INSERT INTO recurring_streams(id,ledger_id,item_id,stream_id,account_id,currency,source_status,source_frequency,frequency,is_outflow)
      VALUES (?,?,?,?,?,'CAD','MATURE','MONTHLY','MONTHLY',1)`).bind(`${user}-stream`,ledger,`${user}-item`,'same-stream',`${user}-account`).run();
  }
    const other=user==='owner'?'second':'owner';
    for(const mode of ['web','native']) {
      const prefix=mode==='web'?'/api':'/api/mobile/v1';
      const identity=mode==='web'?{web:`${user}-subject`}:{token:tokens.get(user)!};
      for(const path of ['/recurring','/recurring/summary?start=2026-10-01&end=2026-10-31&today=2026-10-24',`/recurring/${user}-stream`]) {
        const response=await callRoute(env,routeRequest(prefix+path,identity));
        expect(response.status,await response.clone().text()).toBe(200);
        expect(await response.text()).not.toContain(`${other}-stream`);
      }
      expect((await callRoute(env,routeRequest(`${prefix}/recurring/${other}-stream`,identity))).status).toBe(404);
      const body=mode==='web'?{classification:'subscription'}:{expectedRevision:1,classification:'bill'};
      await responseJson(await callRoute(env,routeRequest(`${prefix}/recurring/${user}-stream/classification`,identity,'PATCH',body)),200);
      expect((await callRoute(env,routeRequest(`${prefix}/recurring/${other}-stream/classification`,identity,'PATCH',body))).status).toBe(404);
    }
});

it('confirms web review targets and preserves append-only annotations for equal operation IDs',async()=>{
  const {db,env,tokens}=await setup();
  const targets=new Map<string,string>();
  for(const user of ['owner','second']) {
    const web={web:`${user}-subject`};const native={token:tokens.get(user)!};
    await responseJson(await callRoute(env,routeRequest('/api/mobile/v1/alerts',{token:`capture-${user}`},'POST',{
      events:[event({sourceProfileId:`${user}-profile`,parserVersion:'v1'})],
    })),200);
    const imported=await responseJson<{transactionIds:string[]}>(await callRoute(env,routeRequest('/api/imports/commit',web,'POST',{
      operationId:'same-import',accountId:`${user}-account`,filename:'statement.csv',fileSha256:'e'.repeat(64),
      transactions:[{...importRow(user),amountMinor:-1234}],
    })),201);
    const target=imported.transactionIds[0];targets.set(user,target);
    const reviewBody={id:'same-confirm-operation',alertEventId:event().eventId,statementTransactionId:target,
      relation:'confirms',evidenceBasis:'user_review',revision:2};
    const reviewed=await responseJson(await callRoute(env,routeRequest('/api/imports/review',web,'POST',reviewBody)),201);
    expect(reviewed).toMatchObject({alertEventId:event().eventId,transactionId:target,projectionSuperseded:true});
    await responseJson(await callRoute(env,routeRequest('/api/imports/review',web,'POST',reviewBody)),200);
    for(const revision of [0,1]) {
      const annotated=await responseJson(await callRoute(env,routeRequest(`/api/mobile/v1/transactions/${target}/annotation`,native,'PATCH',{
        expectedRevision:revision,category:'Travel',note:`Revision ${revision+1}`,
      })),200);
      expect(annotated).toMatchObject({id:target,revision:revision+1});
    }
    const stale=await callRoute(env,routeRequest(`/api/mobile/v1/transactions/${target}/annotation`,native,'PATCH',{expectedRevision:0,category:'Other',note:null}));
    expect(stale.status).toBe(409);
  }
  expect(await db.prepare('SELECT COUNT(*) AS n FROM annotation_revisions').first()).toEqual({n:4});
  expect((await callRoute(env,routeRequest(`/api/mobile/v1/transactions/${targets.get('owner')}/annotation`,{token:tokens.get('second')!},'PATCH',{
    expectedRevision:2,category:'Other',note:null,
  }))).status).toBe(404);
  expect(await db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE source='statement'").first()).toEqual({n:2});
});

it('resolves native staged duplicate candidates within their exact preview and ledger',async()=>{
  const {env,tokens}=await setup();const saved:Array<{user:string;preview:string;candidate:string}>=[];
  for(const user of ['owner','second']) {
    const native={token:tokens.get(user)!};
    await responseJson(await callRoute(env,routeRequest('/api/mobile/v1/alerts',{token:`capture-${user}`},'POST',{
      events:[event({sourceProfileId:`${user}-profile`,parserVersion:'v1'})],
    })),200);
    const preview=await responseJson<{id:string}>(await callRoute(env,routeRequest('/api/mobile/v1/imports/previews',native,'POST',{
      accountId:`${user}-account`,fileName:'duplicates.csv',fileSizeBytes:100,fileSha256:'d'.repeat(64),format:'csv',rowCount:1,
    },'same-duplicate-preview')),201);
    const staged=await responseJson<{revision:number;duplicateCandidates:Array<{id:string}>}>(await callRoute(env,routeRequest(`/api/mobile/v1/imports/${preview.id}/chunks/0`,native,'PUT',{
      rowStart:0,rows:[{...importRow(user),date:'2026-10-13',merchant:'Synthetic merchant',amountMinor:-1234}],
    },'same-duplicate-chunk')),200);
    expect(staged.duplicateCandidates).toHaveLength(1);const candidate=staged.duplicateCandidates[0].id;
    saved.push({user,preview:preview.id,candidate});
    const decision=await responseJson<{revision:number}>(await callRoute(env,routeRequest(`/api/mobile/v1/imports/${preview.id}/duplicates/${encodeURIComponent(candidate)}`,native,'PATCH',{
      expectedRevision:staged.revision,decision:'resolve',
    },'same-duplicate-decision')),200);
    await responseJson(await callRoute(env,routeRequest(`/api/mobile/v1/imports/${preview.id}/commit`,native,'POST',{
      expectedRevision:decision.revision,rowIds:['shared-row'],
    },'same-duplicate-commit')),200);
  }
  const owner=saved[0];
  expect((await callRoute(env,routeRequest(`/api/mobile/v1/imports/${owner.preview}/duplicates/${encodeURIComponent(owner.candidate)}`,{token:tokens.get('second')!},'PATCH',{
    expectedRevision:2,decision:'resolve',
  },'foreign-decision'))).status).toBe(404);
});
