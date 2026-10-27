import type { D1Database, D1Statement } from './db-types';
import type { LedgerContext } from './tenant-context';
import { assertFinancialAuthority, financialAuthorityGuard, type FinancialContext } from './financial-authority';
import { ledgerScopedIdentifier } from './ledger-identifiers';

export class PlaidOwnershipConflictError extends Error {
  readonly code='plaid_ownership_recovery_required';
  readonly status=409;
  readonly retryable=false;
  constructor(){super('Plaid account ownership is unresolved or conflicts with this connection; operator recovery is required.');this.name='PlaidOwnershipConflictError';}
}
async function assertExistingAccountOwnership(db:D1Database,context:LedgerContext,identity:{accountId:string;itemId:string;providerAccountId:string}) {
  const unresolved=await db.prepare(`SELECT 1 FROM accounts a WHERE a.id=? AND a.ledger_id=? AND NOT EXISTS
    (SELECT 1 FROM plaid_account_ownership p WHERE p.account_id=a.id AND p.ledger_id=a.ledger_id AND p.item_id=? AND p.provider_account_id=?)`)
    .bind(identity.accountId,context.ledgerId,identity.itemId,identity.providerAccountId).first();
  if(unresolved)throw new PlaidOwnershipConflictError();
}
export interface PlaidConnectionAccount {
  providerAccountId: string; name: string; currency: string; kind: string; mask: string | null; subtype: string | null;
}
export interface PlaidConnectionPublication {
  providerItemId: string; institution: string; institutionId?: string | null;
  ciphertext: string; iv: string; accounts: PlaidConnectionAccount[];
}
export async function plaidItemIdentifier(context: LedgerContext, raw: string) {
  return ledgerScopedIdentifier(context, 'plaid-item', raw);
}
export function plaidClientUserId(context: LedgerContext, legacy?: string) {
  return context.userId === 'owner' && context.ledgerId === 'personal' ? legacy ?? 'border-ledger-owner' : `ledger:${context.ledgerId}`;
}
export async function plaidAccountIdentifiers(context: LedgerContext, itemId: string, raw: string) {
  const identity = context.ledgerId === 'personal' ? raw : JSON.stringify([itemId,raw]);
  return {providerId: await ledgerScopedIdentifier(context,'plaid-account',identity),
    accountId: await ledgerScopedIdentifier(context,'plaid-ledger-account',context.ledgerId==='personal'?`plaid-${raw}`:identity)};
}
function identityGuard(db:D1Database, context:LedgerContext, identity:{itemId:string;accountId:string;providerId:string}) {
  const {itemId,accountId,providerId}=identity;
  return db.prepare(`INSERT INTO ledger_preferences(ledger_id) SELECT CASE WHEN
    NOT EXISTS (SELECT 1 FROM plaid_accounts WHERE (plaid_account_id=? OR account_id=?) AND (item_id<>? OR ledger_id<>?))
    AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id=? AND (a.ledger_id<>? OR NOT EXISTS
      (SELECT 1 FROM plaid_account_ownership p WHERE p.account_id=a.id AND p.item_id=? AND p.ledger_id=?)))
    THEN ? ELSE NULL END WHERE 1 ON CONFLICT(ledger_id) DO NOTHING`)
    .bind(providerId,accountId,itemId,context.ledgerId,accountId,context.ledgerId,itemId,context.ledgerId,context.ledgerId);
}
export async function connectionPublicationStatements(db:D1Database, context:FinancialContext, input:PlaidConnectionPublication) {
  await assertFinancialAuthority(db,context,'connections:manage');
  const itemId=await plaidItemIdentifier(context,input.providerItemId);
  const statements:D1Statement[]=[financialAuthorityGuard(db,context,'connections:manage'),
    db.prepare(`INSERT INTO ledger_preferences(ledger_id) SELECT CASE WHEN NOT EXISTS
      (SELECT 1 FROM plaid_items WHERE item_id=? AND (ledger_id<>? OR provider_item_id IS NOT ?))
      THEN ? ELSE NULL END WHERE 1 ON CONFLICT(ledger_id) DO NOTHING`).bind(itemId,context.ledgerId,input.providerItemId,context.ledgerId)];
  const accounts=[];
  for(const account of input.accounts) {
    const ids=await plaidAccountIdentifiers(context,itemId,account.providerAccountId);
    await assertExistingAccountOwnership(db,context,{itemId,accountId:ids.accountId,providerAccountId:account.providerAccountId});
    statements.push(identityGuard(db,context,{itemId,...ids}));
    accounts.push({...account,...ids});
  }
  statements.push(db.prepare(`INSERT INTO plaid_items(item_id,ledger_id,provider_item_id,access_token_ciphertext,access_token_iv,institution_id,institution_name)
    VALUES (?,?,?,?,?,?,?) ON CONFLICT(item_id) DO UPDATE SET access_token_ciphertext=excluded.access_token_ciphertext,
    access_token_iv=excluded.access_token_iv,institution_id=excluded.institution_id,institution_name=excluded.institution_name,updated_at=CURRENT_TIMESTAMP`)
    .bind(itemId,context.ledgerId,input.providerItemId,input.ciphertext,input.iv,input.institutionId??null,input.institution));
  statements.push(db.prepare(`UPDATE sync_state SET lifecycle='active',connection_revision=connection_revision+1,
    requested_generation=requested_generation+1,cursor=NULL,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE connection_id=? AND ledger_id=?`)
    .bind(`plaid:${itemId}`,context.ledgerId));
  statements.push(db.prepare(`INSERT INTO recurring_sync_state(item_id,ledger_id,lifecycle,scope_version) VALUES (?,?,'active',0)
    ON CONFLICT(item_id) DO UPDATE SET lifecycle='active',scope_version=scope_version+1,updated_at=CURRENT_TIMESTAMP`).bind(itemId,context.ledgerId));
  // Check all account identities before replacing the selected mapping set.
  statements.push(db.prepare('DELETE FROM plaid_accounts WHERE item_id=? AND ledger_id=?').bind(itemId,context.ledgerId));
  for(const account of accounts) {
    statements.push(db.prepare(`INSERT INTO accounts(id,ledger_id,name,institution,currency,kind,status) VALUES (?,?,?,?,?,?,'connected')
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,institution=excluded.institution,kind=excluded.kind,status='connected'`)
      .bind(account.accountId,context.ledgerId,account.name,input.institution,account.currency,account.kind));
    statements.push(db.prepare('UPDATE accounts SET currency=? WHERE id=? AND ledger_id=? AND currency<>?').bind(account.currency,account.accountId,context.ledgerId,account.currency));
    statements.push(db.prepare('INSERT OR IGNORE INTO plaid_account_ownership(account_id,ledger_id,item_id,provider_account_id) VALUES (?,?,?,?)').bind(account.accountId,context.ledgerId,itemId,account.providerAccountId));
    statements.push(db.prepare('INSERT OR IGNORE INTO account_currencies(ledger_id,account_id,currency) VALUES (?,?,?)').bind(context.ledgerId,account.accountId,account.currency));
    statements.push(db.prepare(`INSERT INTO plaid_accounts(plaid_account_id,ledger_id,provider_account_id,item_id,account_id,name,mask,subtype)
      VALUES (?,?,?,?,?,?,?,?)`).bind(account.providerId,context.ledgerId,account.providerAccountId,itemId,account.accountId,account.name,account.mask,account.subtype));
  }
  return {itemId,accounts,statements};
}
export async function readStoredPlaidItem(db:D1Database, context:LedgerContext, itemId:string) {
  return db.prepare('SELECT * FROM plaid_items WHERE item_id=? AND ledger_id=?').bind(itemId,context.ledgerId)
    .first<{item_id:string;provider_item_id:string;access_token_ciphertext:string;access_token_iv:string;institution_name:string|null}>();
}
export async function beginPlaidDisconnect(db:D1Database, context:FinancialContext, itemId:string) {
  await assertFinancialAuthority(db,context,'connections:manage');
  await db.batch([financialAuthorityGuard(db,context,'connections:manage'),
    db.prepare(`UPDATE sync_state SET lifecycle='disconnecting',connection_revision=connection_revision+1,updated_at=CURRENT_TIMESTAMP
      WHERE connection_id=? AND ledger_id=? AND lifecycle='active'`).bind(`plaid:${itemId}`,context.ledgerId),
    db.prepare(`UPDATE recurring_sync_state SET lifecycle='disconnecting',scope_version=scope_version+1,updated_at=CURRENT_TIMESTAMP
      WHERE item_id=? AND ledger_id=? AND lifecycle='active'`).bind(itemId,context.ledgerId),
    db.prepare("UPDATE mobile_connections SET state='disconnecting',updated_at=CURRENT_TIMESTAMP WHERE item_id=? AND ledger_id=? AND state IN ('connected','syncing','failed')").bind(itemId,context.ledgerId)]);
  return db.prepare('SELECT connection_revision AS revision FROM sync_state WHERE connection_id=? AND ledger_id=?')
    .bind(`plaid:${itemId}`,context.ledgerId).first<{revision:number}>();
}
export function disconnectPublicationStatements(db:D1Database, context:FinancialContext,itemId:string,revision:number) {
  return [financialAuthorityGuard(db,context,'connections:manage'),
    db.prepare(`INSERT INTO ledger_preferences(ledger_id) SELECT CASE WHEN EXISTS
      (SELECT 1 FROM sync_state WHERE connection_id=? AND ledger_id=? AND lifecycle='disconnecting' AND connection_revision=?)
      THEN ? ELSE NULL END WHERE 1 ON CONFLICT(ledger_id) DO NOTHING`).bind(`plaid:${itemId}`,context.ledgerId,revision,context.ledgerId),
    db.prepare(`UPDATE accounts SET status='import_only',last_synced_at=NULL WHERE ledger_id=? AND id IN
      (SELECT account_id FROM plaid_accounts WHERE item_id=? AND ledger_id=?)`).bind(context.ledgerId,itemId,context.ledgerId),
    db.prepare("UPDATE mobile_connections SET state='canceled',cleanup_state='succeeded',updated_at=CURRENT_TIMESTAMP WHERE item_id=? AND ledger_id=?").bind(itemId,context.ledgerId),
    db.prepare('DELETE FROM plaid_accounts WHERE item_id=? AND ledger_id=?').bind(itemId,context.ledgerId),
    db.prepare('DELETE FROM recurring_sync_state WHERE item_id=? AND ledger_id=?').bind(itemId,context.ledgerId),
    db.prepare('DELETE FROM plaid_items WHERE item_id=? AND ledger_id=?').bind(itemId,context.ledgerId),
    db.prepare("UPDATE sync_state SET lifecycle='disconnected',cursor=NULL,updated_at=CURRENT_TIMESTAMP WHERE connection_id=? AND ledger_id=?").bind(`plaid:${itemId}`,context.ledgerId)];
}
