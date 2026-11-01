import type {D1Database} from './db-types';
import type {LedgerContext} from './tenant-context';
import {connectionBinding,lunchFlowScopePredicate,type LunchFlowBinding} from './lunchflow-scope';
import {getCurrencyMeta} from '../src/domain/currencies';
export interface BalancePublication {providerAccountId:string;accountId:string;revision:number;currency:string;amountMinor:number;observedAt:string}
export interface StoredBalance {accountId:string;currency:string;amountMinor:number;observedAt:string;stale:number}
export async function readLunchFlowBalances(db:D1Database, context:LedgerContext):Promise<StoredBalance[]> {
  const rows=await db.prepare(`SELECT b.account_id AS accountId,b.currency,b.amount_minor AS amountMinor,b.observed_at AS observedAt,
    CASE WHEN a.enabled=1 AND a.currency=b.currency AND a.revision=b.account_revision AND c.generation=b.connection_generation AND c.lifecycle='connected' AND b.refresh_failed=0 THEN 0 ELSE 1 END AS stale
    FROM lunchflow_account_balances b LEFT JOIN lunchflow_accounts a ON a.ledger_id=b.ledger_id AND a.account_id=b.account_id AND a.connection_id=b.connection_id AND a.provider_account_id=b.provider_account_id
    LEFT JOIN lunchflow_connections c ON c.ledger_id=b.ledger_id AND c.id=b.connection_id WHERE b.ledger_id=? ORDER BY b.account_id`).bind(context.ledgerId).all<StoredBalance>();
  return rows.results;
}
function validatePublication(input:BalancePublication):void {
  if (!Number.isSafeInteger(input.amountMinor)) throw new RangeError('Invalid balance');
  if (!getCurrencyMeta(input.currency)) throw new RangeError('Invalid balance');
  validateBalanceRevision(input);
}
function validateBalanceRevision(input:BalancePublication):void {
  if (!Number.isSafeInteger(input.revision)) throw new RangeError('Invalid balance revision');
  if (input.revision < 1) throw new RangeError('Invalid balance revision');
  if (!Number.isFinite(Date.parse(input.observedAt))) throw new RangeError('Invalid balance time');
}
export async function publishLunchFlowBalance(db:D1Database,context:LunchFlowBinding,input:BalancePublication):Promise<boolean> {
  validatePublication(input);
  const binding=connectionBinding(context), fence=lunchFlowScopePredicate(context);
  const result=await db.prepare(`INSERT INTO lunchflow_account_balances(ledger_id,account_id,connection_id,connection_generation,provider_account_id,account_revision,currency,amount_minor,observed_at)
    SELECT ?,?,?,?,?,?,?,?,? WHERE ${fence.sql} AND EXISTS (SELECT 1 FROM lunchflow_accounts a WHERE a.ledger_id=? AND a.connection_id=? AND a.provider_account_id=? AND a.account_id=? AND a.revision=? AND a.currency=? AND a.enabled=1)
    ON CONFLICT(ledger_id,account_id) DO UPDATE SET connection_id=excluded.connection_id,connection_generation=excluded.connection_generation,provider_account_id=excluded.provider_account_id,account_revision=excluded.account_revision,currency=excluded.currency,amount_minor=excluded.amount_minor,observed_at=excluded.observed_at,refresh_failed=0
    WHERE excluded.observed_at>=lunchflow_account_balances.observed_at`)
    .bind(context.ledgerId,input.accountId,binding.id,binding.generation,input.providerAccountId,input.revision,input.currency,input.amountMinor,input.observedAt,...fence.bindings,context.ledgerId,binding.id,input.providerAccountId,input.accountId,input.revision,input.currency).run();
  return result.meta?.changes===1;
}


export async function markLunchFlowBalanceFailed(db:D1Database,context:LunchFlowBinding,input:Pick<BalancePublication,'accountId'|'providerAccountId'|'revision'|'observedAt'>):Promise<void> {
  const binding=connectionBinding(context), fence=lunchFlowScopePredicate(context);
  await db.prepare(`UPDATE lunchflow_account_balances SET refresh_failed=1 WHERE ledger_id=? AND account_id=? AND connection_id=? AND connection_generation=? AND provider_account_id=? AND account_revision=? AND observed_at<=? AND ${fence.sql}
    AND EXISTS (SELECT 1 FROM lunchflow_accounts a WHERE a.ledger_id=? AND a.connection_id=? AND a.provider_account_id=? AND a.account_id=? AND a.revision=? AND a.enabled=1)`)
    .bind(context.ledgerId,input.accountId,binding.id,binding.generation,input.providerAccountId,input.revision,input.observedAt,...fence.bindings,context.ledgerId,binding.id,input.providerAccountId,input.accountId,input.revision).run();
}
