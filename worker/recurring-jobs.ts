import type { D1Database } from './db-types';
import type { LedgerContext } from './tenant-context';

export interface RecurringJobBinding extends LedgerContext {
  itemId: string;
  generation: number;
  scopeVersion: number;
  connectionRevision: number;
}

/** Resolve only stored connection ownership and active demand, never a client ledger selector. */
export async function readRecurringJobBinding(db: D1Database, itemId: string) {
  return db.prepare(`SELECT l.user_id AS userId, p.ledger_id AS ledgerId, p.item_id AS itemId,
      s.requested_generation AS generation, s.scope_version AS scopeVersion, c.connection_revision AS connectionRevision
    FROM plaid_items p JOIN recurring_sync_state s ON s.item_id=p.item_id AND s.ledger_id=p.ledger_id
    JOIN sync_state c ON c.connection_id='plaid:'||p.item_id AND c.ledger_id=p.ledger_id AND c.lifecycle='active'
    JOIN ledgers l ON l.id=p.ledger_id JOIN users u ON u.id=l.user_id
    WHERE p.item_id=? AND s.lifecycle='active' AND u.status='active'`).bind(itemId).first<RecurringJobBinding>();
}

export async function verifiedRecurringJob(db: D1Database, message: Record<string, unknown>) {
  if (typeof message.itemId !== 'string') return null;
  const binding = await readRecurringJobBinding(db, message.itemId);
  if (!binding) return null;
  if (binding.userId !== message.userId || binding.ledgerId !== message.ledgerId) return null;
  if (binding.connectionRevision !== message.connectionRevision) return null;
  if (binding.generation !== message.generation || binding.scopeVersion !== message.scopeVersion) return null;
  return binding;
}
