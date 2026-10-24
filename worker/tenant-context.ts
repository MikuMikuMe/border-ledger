import type { D1Database } from './db-types';

export interface LedgerContext {
  userId: string;
  ledgerId: string;
}

export interface VerifiedIdentityBinding {
  issuer: string;
  subject: string;
}

/** Resolve a verified issuer/subject only; this read path never enrolls users. */
export async function resolveLedgerContext(db: D1Database, identity: VerifiedIdentityBinding): Promise<LedgerContext> {
  const context = await db.prepare(`SELECT u.id AS userId, l.id AS ledgerId
    FROM user_identities i JOIN users u ON u.id = i.user_id JOIN ledgers l ON l.user_id = u.id
    WHERE i.issuer = ? AND i.subject = ? AND u.status = 'active'`)
    .bind(identity.issuer, identity.subject).first<LedgerContext>();
  if (!context) throw new Error('Access is not enabled');
  return context;
}

/** Operator-only provisioning. Never call from an HTTP authentication path.
 * Bindings must come from independently verified owner identities, not client input.
 * D1 batch rolls back every binding if any existing identity or owner mapping conflicts.
 */
export async function provisionOwnerIdentityBindings(db: D1Database, bindings: readonly VerifiedIdentityBinding[]): Promise<void> {
  if (!bindings.length) throw new Error('Verified owner identity bindings are required');
  if (bindings.some(binding => [binding.issuer, binding.subject].some(value => !value.trim()))) {
    throw new Error('Verified owner identity bindings are required');
  }
  await db.batch(bindings.map(binding => db.prepare(`INSERT INTO user_identities (issuer, subject, user_id)
    VALUES (?, ?, CASE WHEN EXISTS (
      SELECT 1 FROM users u JOIN ledgers l ON l.user_id = u.id
      WHERE u.id = 'owner' AND u.status = 'active' AND l.id = 'personal'
    ) THEN 'owner' ELSE NULL END)
    ON CONFLICT(issuer, subject) DO NOTHING`).bind(binding.issuer, binding.subject)));
}

/** Resolve ownership from an already-authenticated server-side credential or job binding. */
export async function resolveActiveLedgerContext(db: D1Database, ledgerId: string): Promise<LedgerContext> {
  const context = await db.prepare(`SELECT u.id AS userId, l.id AS ledgerId
    FROM ledgers l JOIN users u ON u.id = l.user_id
    WHERE l.id = ? AND u.status = 'active'`).bind(ledgerId).first<LedgerContext>();
  if (!context) throw new Error('Access is not enabled');
  return context;
}

export class LedgerAccessError extends Error {
  readonly code = 'access_not_enabled';
  readonly retryable = false;
  readonly status = 403;
  constructor() { super('Access is not enabled'); this.name = 'LedgerAccessError'; }
}

/** Revalidate a previously trusted context before long-running financial work. */
export async function assertActiveLedgerContext(db: D1Database, context: LedgerContext) {
  const active = await db.prepare(`SELECT 1 AS active FROM ledgers l JOIN users u ON u.id = l.user_id
    WHERE l.id = ? AND u.id = ? AND u.status = 'active'`).bind(context.ledgerId, context.userId).first();
  if (!active) throw new LedgerAccessError();
}
