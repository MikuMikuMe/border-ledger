import type { D1Database } from './db-types';
import { createLunchFlowService, type LunchFlowServiceEnv } from './lunchflow-service';
import { oauthConfigured } from './lunchflow-connections';
import { parseLunchFlowQueueAccounts } from './lunchflow-routing';
import type { LunchFlowScope } from './lunchflow-scope';
interface ActiveConnection {id:string;user_id:string;ledger_id:string;generation:number;adapter:'personal'|'platform'}
const ACTIVE=`SELECT c.id,c.user_id,c.ledger_id,c.generation,c.adapter FROM lunchflow_connections c
 JOIN ledgers l ON l.id=c.ledger_id AND l.user_id=c.user_id JOIN users u ON u.id=c.user_id
 WHERE u.status='active' AND c.lifecycle='connected'`;
function scope(row:ActiveConnection):LunchFlowScope {return Object.freeze({userId:row.user_id,ledgerId:row.ledger_id,connection:Object.freeze({id:row.id,generation:row.generation,adapter:row.adapter})});}
function validJob(body:Record<string,unknown>) {
 return [body.userId,body.ledgerId,body.connectionId].every(value=>typeof value==='string'&&value.length>0&&value.length<=256)
   && typeof body.generation==='number'&&Number.isSafeInteger(body.generation)&&body.generation>0;
}
export async function verifiedLunchFlowJob(db:D1Database,body:Record<string,unknown>) {
 if(!validJob(body))return null;
 const row=await db.prepare(ACTIVE+' AND c.id=? AND c.user_id=? AND c.ledger_id=? AND c.generation=?')
  .bind(body.connectionId,body.userId,body.ledgerId,body.generation).first<ActiveConnection>();
 return row?scope(row):null;
}
export async function runLunchFlowJob(env:LunchFlowServiceEnv,body:Record<string,unknown>) {
 const binding=await verifiedLunchFlowJob(env.DB,body),accounts=parseLunchFlowQueueAccounts(body.accounts);
 if(!binding||!accounts)return;
 if(typeof body.jobId!=='string'||!/^[0-9a-f-]{36}$/i.test(body.jobId))return;
 await createLunchFlowService(env,binding).sync(accounts.map(account=>({...account,syncJobId:body.jobId as string})));
}
export async function scheduleLunchFlow(env:LunchFlowServiceEnv) {
 const rows=await env.DB.prepare(ACTIVE).all<ActiveConnection>();
 for(const row of rows.results){
  const configured=row.adapter==='personal'?Boolean(env.LUNCHFLOW_API_KEY?.trim()):oauthConfigured(env);
  if(!configured)continue;
  try{await createLunchFlowService(env,scope(row)).requestSync('scheduled-sync');}
  catch(error){console.error('lunchflow_schedule_failed',error instanceof Error?error.name:'unknown');}
 }
}
