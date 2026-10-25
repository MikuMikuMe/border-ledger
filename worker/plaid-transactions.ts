import type { D1Database, D1Statement } from './db-types';
import type { LedgerContext } from './tenant-context';
import { financialAuthorityGuard } from './financial-authority';
import { ledgerScopedIdentifier } from './ledger-identifiers';
import type { MappedPlaidTransaction } from './plaid';

function plaidSourceIdentity(mapped: MappedPlaidTransaction) {
  if (!mapped.plaidItemId) return null;
  const providerIdentity = mapped.providerTransactionId
    ?? (mapped.providerPendingTransactionId ? `pending:${mapped.providerPendingTransactionId}` : null);
  if (!providerIdentity) return null;
  return `plaid:${mapped.plaidItemId}:${providerIdentity}`;
}

function plaidSourceContentDigest(mapped: MappedPlaidTransaction) {
  return [
    mapped.accountId,
    mapped.date,
    mapped.merchant,
    mapped.amountMinor,
    mapped.currency,
    mapped.category,
    mapped.kind,
    mapped.status,
    mapped.fingerprint,
    mapped.plaidItemId,
    mapped.providerTransactionId,
    mapped.providerPendingTransactionId,
  ].map((value) => value ?? '').join('|');
}

async function existingPlaidTransactionId(db:D1Database,context:LedgerContext,mapped:MappedPlaidTransaction) {
  const rows=await db.prepare(`SELECT id FROM transactions WHERE ledger_id=? AND account_id=? AND plaid_item_id=? AND source='plaid'
    AND ((? IS NOT NULL AND provider_transaction_id=?) OR (? IS NOT NULL AND provider_pending_transaction_id=?))
    ORDER BY CASE WHEN provider_transaction_id=? THEN 0 ELSE 1 END LIMIT 1`)
    .bind(context.ledgerId,mapped.accountId,mapped.plaidItemId,mapped.providerTransactionId,mapped.providerTransactionId,
      mapped.providerPendingTransactionId,mapped.providerPendingTransactionId,mapped.providerTransactionId).all<{id:string}>();
  return rows.results[0]?.id??null;
}
function transactionGuard(db:D1Database,context:LedgerContext,mapped:MappedPlaidTransaction,id:string) {
  return db.prepare(`INSERT INTO ledger_preferences(ledger_id) SELECT CASE WHEN
    EXISTS(SELECT 1 FROM accounts WHERE id=? AND ledger_id=?)
    AND EXISTS(SELECT 1 FROM plaid_accounts WHERE account_id=? AND item_id=? AND ledger_id=?)
    AND NOT EXISTS(SELECT 1 FROM transactions t WHERE t.id=? AND (t.ledger_id IS NOT ? OR t.account_id IS NOT ?
      OR t.source IS NOT 'plaid' OR t.plaid_item_id IS NOT ? OR NOT
      ((? IS NOT NULL AND t.provider_transaction_id IS ?) OR (? IS NOT NULL AND t.provider_pending_transaction_id IS ?))))
    THEN ? ELSE NULL END WHERE 1 ON CONFLICT(ledger_id) DO NOTHING`)
    .bind(mapped.accountId,context.ledgerId,mapped.accountId,mapped.plaidItemId,context.ledgerId,id,context.ledgerId,mapped.accountId,mapped.plaidItemId,
      mapped.providerTransactionId,mapped.providerTransactionId,mapped.providerPendingTransactionId,mapped.providerPendingTransactionId,context.ledgerId);
}
export async function plaidTransactionStatements(db:D1Database,context:LedgerContext,mapped:MappedPlaidTransaction) {
  if(!mapped.plaidItemId)throw new Error('Plaid transaction requires a stored connection.');
  const existingId=await existingPlaidTransactionId(db,context,mapped);
  const id=existingId??await ledgerScopedIdentifier(context,'plaid-transaction',mapped.id);
  const item=await db.prepare('SELECT provider_item_id FROM plaid_items WHERE item_id=? AND ledger_id=?').bind(mapped.plaidItemId,context.ledgerId).first<{provider_item_id:string}>();
  if(!item?.provider_item_id)throw new Error('Plaid raw provider identity is unavailable.');
  const identity=plaidSourceIdentity({...mapped,plaidItemId:item.provider_item_id});
  if(!identity)throw new Error('Plaid transaction requires provider identity.');
  const sourceId=await ledgerScopedIdentifier(context,'plaid-source',`source-record:${identity}`);
  const statements:D1Statement[]=[transactionGuard(db,context,mapped,id),
    db.prepare(`INSERT INTO ledger_preferences(ledger_id) SELECT CASE WHEN NOT EXISTS
      (SELECT 1 FROM transaction_source_records WHERE (id=? OR (ledger_id=? AND source_kind='plaid' AND identity_key=?))
       AND (ledger_id IS NOT ? OR source_kind IS NOT 'plaid' OR identity_key IS NOT ? OR transaction_id IS NOT ?
       OR account_id IS NOT ? OR provider_item_id IS NOT ?))
      THEN ? ELSE NULL END WHERE 1 ON CONFLICT(ledger_id) DO NOTHING`)
      .bind(sourceId,context.ledgerId,identity,context.ledgerId,identity,id,mapped.accountId,item.provider_item_id,context.ledgerId),
    db.prepare(`INSERT INTO transactions(id,ledger_id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,
      fingerprint,note,plaid_item_id,provider_transaction_id,provider_pending_transaction_id,fx_lock_date)
      VALUES (?,?,?,?,?,?,?,?,?,?,'plaid',?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      date=excluded.date,merchant=excluded.merchant,amount_minor=excluded.amount_minor,currency=excluded.currency,
      category=excluded.category,kind=excluded.kind,status=excluded.status,fingerprint=excluded.fingerprint,note=excluded.note,
      provider_transaction_id=COALESCE(excluded.provider_transaction_id,transactions.provider_transaction_id),
      provider_pending_transaction_id=COALESCE(excluded.provider_pending_transaction_id,transactions.provider_pending_transaction_id),updated_at=CURRENT_TIMESTAMP`)
      .bind(id,context.ledgerId,mapped.accountId,mapped.date,mapped.merchant,mapped.amountMinor,mapped.currency,mapped.category,mapped.kind,mapped.status,
        mapped.fingerprint,mapped.note??null,mapped.plaidItemId,mapped.providerTransactionId,mapped.providerPendingTransactionId,mapped.date),
    db.prepare(`INSERT INTO transaction_source_records(id,ledger_id,source_kind,identity_key,transaction_id,account_id,provider_item_id,
      provider_transaction_id,provider_pending_transaction_id,content_digest) VALUES (?,?,'plaid',?,?,?,?,?,?,?)
      ON CONFLICT(ledger_id,source_kind,identity_key) DO UPDATE SET content_digest=excluded.content_digest,
      provider_transaction_id=COALESCE(excluded.provider_transaction_id,transaction_source_records.provider_transaction_id),
      provider_pending_transaction_id=COALESCE(excluded.provider_pending_transaction_id,transaction_source_records.provider_pending_transaction_id)`)
      .bind(sourceId,context.ledgerId,identity,id,mapped.accountId,item.provider_item_id,mapped.providerTransactionId,mapped.providerPendingTransactionId,plaidSourceContentDigest(mapped))];
  return {id,statements};
}
export async function upsertPlaidTransaction(db:D1Database,context:LedgerContext,mapped:MappedPlaidTransaction) {
  const publication=await plaidTransactionStatements(db,context,mapped);
  await db.batch([financialAuthorityGuard(db,context,'connections:manage'),...publication.statements]);
  return publication.id;
}
export function removePlaidTransactionStatement(db:D1Database,context:LedgerContext,itemId:string,providerTransactionId:string) {
  return db.prepare(`DELETE FROM transactions WHERE ledger_id=? AND source='plaid' AND plaid_item_id=?
    AND (provider_transaction_id=? OR (provider_transaction_id IS NULL AND provider_pending_transaction_id=?))`)
    .bind(context.ledgerId,itemId,providerTransactionId,providerTransactionId);
}
export async function removePlaidTransaction(db:D1Database,context:LedgerContext,itemId:string,providerTransactionId:string) {
  await db.batch([financialAuthorityGuard(db,context,'connections:manage'),removePlaidTransactionStatement(db,context,itemId,providerTransactionId)]);
}
