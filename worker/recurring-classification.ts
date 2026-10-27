import type { D1Database } from './db-types';
import { financialAuthorityPredicate, type FinancialContext } from './financial-authority';
import type { RecurringClassification } from '../src/domain/recurring';

export async function publishRecurringClassification(db: D1Database, context: FinancialContext,
  input: {id:string;classification:RecurringClassification;expectedRevision:number}) {
  const authority=financialAuthorityPredicate(context,'recurring:classify');
  const results=await db.batch([
    db.prepare(`INSERT INTO recurring_classifications(recurring_stream_id,ledger_id,classification,revision,updated_at)
      VALUES (?,CASE WHEN ${authority.sql} THEN ? ELSE NULL END,'unclassified',0,CURRENT_TIMESTAMP)
      ON CONFLICT(recurring_stream_id) DO NOTHING`).bind(input.id,...authority.bindings,context.ledgerId),
    db.prepare(`UPDATE recurring_classifications SET classification=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP
      WHERE recurring_stream_id=? AND ledger_id=? AND revision=?`)
      .bind(input.classification,input.id,context.ledgerId,input.expectedRevision),
  ]);
  if(results.some(result=>result.success===false)) throw new Error('Recurring classification publication failed.');
  return (results[1]?.meta?.changes ?? 0)===1;
}
