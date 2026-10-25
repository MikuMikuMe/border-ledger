import type { D1Database } from './db-types';
import type { LedgerContext } from './tenant-context';
import { assertFinancialAuthority, financialAuthorityPredicate, type FinancialContext } from './financial-authority';

export interface PlaidJobBinding extends LedgerContext {itemId:string;generation:number;connectionRevision:number;}
export async function readPlaidJobBinding(db:D1Database,itemId:string) {
  return db.prepare(`SELECT l.user_id AS userId,p.ledger_id AS ledgerId,p.item_id AS itemId,
    s.requested_generation AS generation,s.connection_revision AS connectionRevision FROM plaid_items p
    JOIN sync_state s ON s.connection_id='plaid:'||p.item_id AND s.ledger_id=p.ledger_id
    JOIN ledgers l ON l.id=p.ledger_id JOIN users u ON u.id=l.user_id
    WHERE p.item_id=? AND s.lifecycle='active' AND u.status='active'`).bind(itemId).first<PlaidJobBinding>();
}
async function matchingPlaidJob(db:D1Database,message:Record<string,unknown>) {
  if(typeof message.itemId!=='string')return null;
  const binding=await readPlaidJobBinding(db,message.itemId);
  if(!binding)return null;
  return ['userId','ledgerId','itemId','generation','connectionRevision'].every(key=>binding[key as keyof PlaidJobBinding]===message[key])?binding:null;
}

export async function verifiedPlaidJob(db:D1Database,message:Record<string,unknown>) {
  const binding=await matchingPlaidJob(db,message);if(!binding)return null;
  const pending=await db.prepare(`SELECT 1 FROM sync_state WHERE connection_id=? AND ledger_id=? AND completed_generation<?`)
    .bind(`plaid:${binding.itemId}`,binding.ledgerId,binding.generation).first();
  return pending?binding:null;
}
export async function pendingPlaidRecurringFollowup(db:D1Database,message:Record<string,unknown>) {
  const binding=await matchingPlaidJob(db,message);if(!binding)return null;
  const pending=await db.prepare(`SELECT 1 FROM sync_state WHERE connection_id=? AND ledger_id=?
    AND completed_generation=? AND recurring_enqueued_generation<?`)
    .bind(`plaid:${binding.itemId}`,binding.ledgerId,binding.generation,binding.generation).first();
  return pending?binding:null;
}
export async function markPlaidRecurringEnqueued(db:D1Database,binding:PlaidJobBinding) {
  await db.prepare(`UPDATE sync_state SET recurring_enqueued_generation=? WHERE connection_id=? AND ledger_id=?
    AND connection_revision=? AND requested_generation=? AND completed_generation=? AND lifecycle='active'`)
    .bind(binding.generation,`plaid:${binding.itemId}`,binding.ledgerId,binding.connectionRevision,binding.generation,binding.generation).run();
}
export async function requestPlaidSync(db:D1Database,context:FinancialContext,queue:{send(message:unknown):Promise<void>}|undefined,itemId:string) {
  await assertFinancialAuthority(db,context,'connections:manage');
  if(!queue)return false;
  const authority=financialAuthorityPredicate(context,'connections:manage');
  const demand=await db.prepare(`UPDATE sync_state SET requested_generation=requested_generation+1,updated_at=CURRENT_TIMESTAMP
    WHERE connection_id=? AND ledger_id=? AND lifecycle='active' AND ${authority.sql}
    AND EXISTS (SELECT 1 FROM plaid_items WHERE item_id=? AND ledger_id=?)
    RETURNING requested_generation AS generation,connection_revision AS connectionRevision`)
    .bind(`plaid:${itemId}`,context.ledgerId,...authority.bindings,itemId,context.ledgerId).first<{generation:number;connectionRevision:number}>();
  if(!demand)return false;
  await assertFinancialAuthority(db,context,'connections:manage');
  await queue.send({type:'plaid-sync',userId:context.userId,ledgerId:context.ledgerId,itemId,...demand});
  return true;
}
export function plaidJobGuard(db:D1Database,binding:PlaidJobBinding) {
 return db.prepare(`INSERT INTO ledger_preferences(ledger_id) SELECT CASE WHEN EXISTS
   (SELECT 1 FROM sync_state s JOIN plaid_items p ON s.connection_id='plaid:'||p.item_id AND s.ledger_id=p.ledger_id
    JOIN ledgers l ON l.id=p.ledger_id JOIN users u ON u.id=l.user_id WHERE p.item_id=? AND p.ledger_id=? AND u.id=?
    AND u.status='active' AND s.lifecycle='active' AND s.connection_revision=? AND s.requested_generation=?
    AND s.completed_generation<?) THEN ? ELSE NULL END WHERE 1 ON CONFLICT(ledger_id) DO NOTHING`)
   .bind(binding.itemId,binding.ledgerId,binding.userId,binding.connectionRevision,binding.generation,binding.generation,binding.ledgerId);
}
export async function resolvePlaidWebhookBinding(db:D1Database,rawItemId:string) {
 const rows=await db.prepare(`SELECT p.item_id FROM plaid_items p JOIN sync_state s ON s.connection_id='plaid:'||p.item_id AND s.ledger_id=p.ledger_id
   JOIN ledgers l ON l.id=p.ledger_id JOIN users u ON u.id=l.user_id
   WHERE p.provider_item_id=? AND s.lifecycle='active' AND u.status='active' LIMIT 2`).bind(rawItemId).all<{item_id:string}>();
 return rows.results.length===1?readPlaidJobBinding(db,rows.results[0].item_id):null;
}
