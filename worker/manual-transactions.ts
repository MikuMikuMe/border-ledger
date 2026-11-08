import { validateInput, matchInput } from './manual-transaction-input';
export { manualMatchOffset } from './manual-transaction-input';
import type { D1Database, D1Statement } from './db-types';
import { assertFinancialAuthority, immutableFinancialContext, type FinancialContext } from './financial-authority';
import { ledgerScopedIdentifier } from './ledger-identifiers';
import { isReviewStateConflict, publishReview, reviewStateGuard } from './review-publication';
import { manualMatchPredicate } from './manual-match-predicate';

export class ManualTransactionConflict extends Error {
  readonly code = 'revision_conflict';
  readonly status = 409;
  readonly retryable = false;
  constructor() { super('This transaction or match has changed. Refresh and try again.'); }
}

async function publishManual(db:D1Database,context:FinancialContext,statements:D1Statement[]) {
  try { await publishReview(db,context,statements); }
  catch(error) {
    if (isReviewStateConflict(error) || /UNIQUE constraint failed: manual_transaction_matches/.test(String(error))) throw new ManualTransactionConflict();
    throw error;
  }
}

export async function createManualTransaction(db: D1Database, authority: FinancialContext, value: unknown) {
  const context = immutableFinancialContext(authority);
  await assertFinancialAuthority(db, context, 'ledger:review');
  const { requestId, accountId, date, merchant, category, currency, kind, amountMinor, note } = validateInput(value);
  const id = await ledgerScopedIdentifier(context, 'manual-transaction', `manual-${requestId}`);
  const sourceId = await ledgerScopedIdentifier(context, 'manual-source', `manual-source-${requestId}`);
  const content = JSON.stringify([accountId, date, merchant, amountMinor, currency, category, kind, note]);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))), b => b.toString(16).padStart(2, '0')).join('');
  const account = await db.prepare('SELECT 1 FROM accounts a JOIN account_currencies c ON c.account_id=a.id AND c.ledger_id=a.ledger_id WHERE a.id=? AND a.ledger_id=? AND c.currency=?').bind(accountId, context.ledgerId, currency).first();
  if (!account) throw new RangeError('Account or currency is not available.');
  await publishManual(db, context, [
    db.prepare(`INSERT OR IGNORE INTO transactions(id,ledger_id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,note,fx_lock_date)
      VALUES(?,?,?,?,?,?,?,?,?,'confirmed','manual',?,?,?)`).bind(id, context.ledgerId, accountId, date, merchant, amountMinor, currency, category, kind, digest, note, date),
    db.prepare(`INSERT OR IGNORE INTO transaction_source_records(id,ledger_id,source_kind,identity_key,transaction_id,account_id,manual_id,content_digest)
      VALUES(?,?,'manual',?,?,?,?,?)`).bind(sourceId, context.ledgerId, `manual:${requestId}`, id, accountId, requestId, digest),
    reviewStateGuard(db, context, `EXISTS(SELECT 1 FROM transaction_source_records s JOIN transactions t ON t.id=s.transaction_id AND t.ledger_id=s.ledger_id
      WHERE s.ledger_id=? AND s.id=? AND s.transaction_id=? AND s.content_digest=? AND t.source='manual' AND t.fingerprint=?)`, [context.ledgerId, sourceId, id, digest, digest]),
  ]);
  return { id };
}

const matchCondition = manualMatchPredicate();

export async function listManualMatches(db: D1Database, context: FinancialContext, offset=0) {
  await assertFinancialAuthority(db, context, 'ledger:read');
  const rows = await db.prepare(`SELECT m.id AS manualId,b.id AS bankId,m.date AS manualDate,b.date AS bankDate,
    m.merchant AS manualMerchant,b.merchant AS bankMerchant,m.amount_minor AS amountMinor,m.currency,m.category,m.note,
    CASE WHEN d.decision='confirmed' AND NOT COALESCE((${matchCondition}),0) THEN 'stale' ELSE COALESCE(d.decision,'open') END AS decision,COALESCE(d.revision,0) AS revision
    FROM transactions m JOIN transactions b ON b.ledger_id=m.ledger_id AND (b.account_id=m.account_id OR EXISTS(SELECT 1 FROM manual_transaction_matches prior WHERE prior.ledger_id=m.ledger_id AND prior.manual_id=m.id AND prior.bank_id=b.id))
    LEFT JOIN manual_transaction_matches d ON d.ledger_id=m.ledger_id AND d.manual_id=m.id AND d.bank_id=b.id
    WHERE m.ledger_id=? AND m.source='manual' AND ((${matchCondition}) OR d.decision IS NOT NULL)
    ORDER BY m.date DESC,m.id,b.id LIMIT 200 OFFSET ?`).bind(context.ledgerId,offset).all();
  return rows.results;
}

export async function decideManualMatch(db: D1Database, authority: FinancialContext, value: unknown) {
  const context = immutableFinancialContext(authority);
  await assertFinancialAuthority(db, context, 'ledger:review');
  const {manualId,bankId,decision,revision} = matchInput(value);
  const prior = await db.prepare('SELECT decision,revision FROM manual_transaction_matches WHERE ledger_id=? AND manual_id=? AND bank_id=?').bind(context.ledgerId,manualId,bankId).first<{decision:string;revision:number}>();
  if (prior?.decision === decision && prior.revision === revision+1) return {manualId,bankId,decision,revision:prior.revision};
  const exists = `EXISTS(SELECT 1 FROM transactions m JOIN transactions b ON b.ledger_id=m.ledger_id
    WHERE m.ledger_id=? AND m.id=? AND b.id=? AND ((${matchCondition}) OR (?='dismissed' AND EXISTS
      (SELECT 1 FROM manual_transaction_matches d WHERE d.ledger_id=m.ledger_id AND d.manual_id=m.id AND d.bank_id=b.id))))`;
  await publishManual(db, context, [
    reviewStateGuard(db, context, exists, [context.ledgerId,manualId,bankId,decision]),
    reviewStateGuard(db, context, `COALESCE((SELECT revision FROM manual_transaction_matches WHERE ledger_id=? AND manual_id=? AND bank_id=?),0)=?`, [context.ledgerId,manualId,bankId,revision]),
    db.prepare(`INSERT INTO manual_transaction_matches(ledger_id,manual_id,bank_id,decision,revision)
      VALUES(?,?,?,?,1)
      ON CONFLICT(ledger_id,manual_id,bank_id) DO UPDATE SET decision=excluded.decision,revision=manual_transaction_matches.revision+1
      WHERE manual_transaction_matches.revision=?`).bind(context.ledgerId,manualId,bankId,decision,revision),
    reviewStateGuard(db, context, `EXISTS(SELECT 1 FROM manual_transaction_matches WHERE ledger_id=? AND manual_id=? AND bank_id=? AND decision=? AND revision=?)`, [context.ledgerId,manualId,bankId,decision,revision+1]),
  ]);
  return { manualId, bankId, decision, revision:revision+1 };
}
