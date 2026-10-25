import type { D1Database } from './db-types';
import type { LedgerContext } from './tenant-context';

/** Public event IDs remain raw UUIDs; callers validate their own authority before this scoped lookup.
 * COALESCE supports legacy operator inserts only. Runtime capture always stores an explicit raw UUID.
 */
export async function resolveAlertEventId(db: D1Database, context: LedgerContext, rawEventId: string): Promise<string> {
  const row = await db.prepare(`SELECT id FROM alert_events WHERE ledger_id = ? AND COALESCE(raw_event_id, event_id) = ?`)
    .bind(context.ledgerId, rawEventId).first<{id:string}>();
  if (!row) throw new RangeError('Alert event is not available in this ledger.');
  return row.id;
}
