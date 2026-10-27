import type { D1Database, D1Statement } from './db-types';
import { assertFinancialAuthority, financialAuthorityGuard, type FinancialContext } from './financial-authority';

/** A failed predicate aborts the whole D1 batch before any review publication. */
export function reviewStateGuard(db: D1Database, context: FinancialContext, predicate: string, bindings: unknown[]) {
  return db.prepare(`INSERT INTO ledger_preferences(ledger_id) VALUES
    (CASE WHEN ${predicate} THEN ? ELSE NULL END) ON CONFLICT(ledger_id) DO NOTHING`)
    .bind(...bindings, context.ledgerId);
}

export function isReviewStateConflict(error: unknown) {
  return /NOT NULL constraint failed: ledger_preferences\.ledger_id|(?:^|: )ledger_preferences ledger mismatch(?:$|:)/i
    .test(error instanceof Error ? error.message : String(error));
}

export async function publishReview(db: D1Database, context: FinancialContext, statements: D1Statement[]) {
  try { await db.batch([financialAuthorityGuard(db, context, 'ledger:review'), ...statements]); }
  catch (error) {
    await assertFinancialAuthority(db, context, 'ledger:review');
    throw error;
  }
  await assertFinancialAuthority(db, context, 'ledger:review');
}
