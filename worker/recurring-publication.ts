import type { D1Database } from './db-types';
import type { LedgerContext } from './tenant-context';

/** A NOT NULL failure aborts the entire publication batch, including last-good rows. */
export function recurringPublicationGuard(db: D1Database, context: LedgerContext, publication: {itemId:string;generation:number;scopeVersion:number;connectionRevision:number;sourceUpdatedAt:string}) {
  const {itemId,generation,scopeVersion,connectionRevision,sourceUpdatedAt} = publication;
  return db.prepare(`INSERT INTO recurring_sync_state(item_id, ledger_id)
    VALUES (?, CASE WHEN EXISTS (
      SELECT 1 FROM recurring_sync_state s
      JOIN plaid_items p ON p.item_id=s.item_id AND p.ledger_id=s.ledger_id
      JOIN sync_state c ON c.connection_id='plaid:'||p.item_id AND c.ledger_id=p.ledger_id
      JOIN ledgers l ON l.id=s.ledger_id JOIN users u ON u.id=l.user_id
      WHERE s.item_id=? AND s.ledger_id=? AND u.id=? AND u.status='active'
        AND c.lifecycle='active' AND c.connection_revision=? AND s.lifecycle='active' AND s.scope_version=?
        AND s.requested_generation=? AND s.completed_generation<=?
        AND (s.source_updated_at IS NULL OR s.source_updated_at<=?)
    ) THEN ? ELSE NULL END) ON CONFLICT(item_id) DO NOTHING`)
    .bind(itemId,itemId,context.ledgerId,context.userId,connectionRevision,scopeVersion,generation,generation,sourceUpdatedAt,context.ledgerId);
}
