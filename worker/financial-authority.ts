import type { D1Database } from './db-types';
import type { OwnerContext } from './mobile-auth';
import { LedgerAccessError, type LedgerContext } from './tenant-context';

export type FinancialContext = LedgerContext | OwnerContext;
type FinancialScope = 'imports:write' | 'exports:read';

function validAuthorityString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function validNativeAuthority(owner: OwnerContext, scope: FinancialScope) {
  const identifiersValid = [owner.familyId, owner.subjectHash, owner.environmentHash].every(validAuthorityString);
  const generationValid = Number.isSafeInteger(owner.accessGeneration) && owner.accessGeneration > 0;
  const scopeValid = Array.isArray(owner.scopes) && owner.scopes.includes(scope);
  return identifiersValid && generationValid && scopeValid;
}

function nativeAuthority(context: FinancialContext, scope: FinancialScope): OwnerContext | null {
  if (!('credentialType' in context)) return null;
  if (context.credentialType !== 'owner') throw new LedgerAccessError();
  const owner = context as OwnerContext;
  if (!validNativeAuthority(owner, scope)) throw new LedgerAccessError();
  return owner;
}

/** Explicit predicates for a publication statement, never a query rewriting layer. */
export function financialAuthorityPredicate(context: FinancialContext, scope: FinancialScope) {
  const owner = nativeAuthority(context, scope);
  let sql = `EXISTS (SELECT 1 FROM ledgers l JOIN users u ON u.id=l.user_id WHERE l.id=? AND u.id=? AND u.status='active')`;
  const bindings: unknown[] = [context.ledgerId, context.userId];
  if (owner) {
    sql += ` AND EXISTS (SELECT 1 FROM owner_session_families f WHERE f.id=? AND f.ledger_id=?
      AND f.subject_hash=? AND f.access_generation=? AND f.environment_hash=? AND f.revoked_at IS NULL AND julianday(f.access_expires_at)>julianday('now')
      AND EXISTS (SELECT 1 FROM json_each(f.scope_json) WHERE value=?))`;
    bindings.push(owner.familyId, owner.ledgerId, owner.subjectHash, owner.accessGeneration, owner.environmentHash, scope);
  }
  return {sql,bindings};
}

export async function assertFinancialAuthority(db: D1Database, context: FinancialContext, scope: FinancialScope) {
  const authority = financialAuthorityPredicate(context, scope);
  const active = await db.prepare(`SELECT 1 AS active WHERE ${authority.sql}`).bind(...authority.bindings).first();
  if (!active) throw new LedgerAccessError();
}
