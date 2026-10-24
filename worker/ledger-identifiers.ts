import type { D1Database } from './db-types';
import type { LedgerContext } from './tenant-context';

/** Preserve historical owner IDs; isolate newly supplied IDs for other ledgers. */
export async function ledgerScopedIdentifier(context: LedgerContext, namespace: string, value: string) {
  if (context.ledgerId === 'personal') return value;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([context.ledgerId, namespace, value])));
  return `tenant-${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function legacyHash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return (result >>> 0).toString(16).padStart(8, '0');
}

export async function statementTransactionIdentifier(db: D1Database, context: LedgerContext,
  input: { rawId: string; identityKey: string; rowIndex: number; occupied: Set<string> }) {
  const exists = async (id: string) => input.occupied.has(id) || Boolean(await db.prepare('SELECT id FROM transactions WHERE id = ? AND ledger_id = ? LIMIT 1')
    .bind(id, context.ledgerId).first());
  const rawIdentity = context.ledgerId === 'personal' ? input.rawId : JSON.stringify([input.identityKey,input.rawId]);
  const proposed = await ledgerScopedIdentifier(context, 'statement-transaction', rawIdentity);
  if (!await exists(proposed)) return proposed;
  const fallback = await ledgerScopedIdentifier(context, 'statement-transaction', `statement-${legacyHash(input.identityKey)}-${input.rowIndex}`);
  if (!await exists(fallback)) return fallback;
  return ledgerScopedIdentifier(context, 'statement-transaction', `${fallback}-${legacyHash(`${input.identityKey}:${proposed}`)}`.slice(0,160));
}
