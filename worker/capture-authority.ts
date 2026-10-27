import type { D1Database } from './db-types';
import { MobileAuthError, type CaptureContext, type CaptureScopeRecord } from './mobile-auth';

function denied():never {throw new MobileAuthError('forbidden','The capture authority or source scope is no longer approved for this resource.',403);}
export function immutableCaptureContext(context: CaptureContext): CaptureContext {
  const sourceScopes = context.sourceScopes.map(scope => Object.freeze({
    ...scope,
    instrumentHint: scope.instrumentHint ? Object.freeze({ ...scope.instrumentHint }) : null,
  }));
  return Object.freeze({ ...context, sourceScopes: Object.freeze(sourceScopes) });
}
export function captureAuthorityPredicate(context:CaptureContext) {
  if(context.credentialType!=='capture'||context.scope!=='alerts:write')denied();
  if(!Number.isSafeInteger(context.generation)||context.generation<1)denied();
  if(!Number.isSafeInteger(context.sourceConfigRevision)||context.sourceConfigRevision<0)denied();
  const sql=`EXISTS (SELECT 1 FROM capture_credentials c JOIN mobile_devices d ON d.id=c.device_id AND d.ledger_id=c.ledger_id
    JOIN ledgers l ON l.id=c.ledger_id JOIN users u ON u.id=l.user_id
    WHERE c.id=? AND c.ledger_id=? AND u.id=? AND u.status='active' AND c.device_id=? AND c.generation=?
      AND c.credential_type='capture' AND c.scope='alerts:write' AND c.environment_hash=? AND c.expires_at=?
      AND c.revoked_at IS NULL AND julianday(c.expires_at)>julianday('now')
      AND d.status='paired' AND d.revoked_at IS NULL AND d.source_config_revision=?)`;
  return {sql,bindings:[context.credentialId,context.ledgerId,context.userId,context.deviceId,context.generation,context.environmentHash,context.expiresAt,context.sourceConfigRevision]};
}
function scopeIdentity(scope: CaptureScopeRecord) {
  return JSON.stringify([scope.sourceProfileId, scope.accountId, scope.currency, scope.instrumentHint?.kind ?? 'none', scope.instrumentHint?.value ?? '']);
}
export function snapshotAllowsCapture(context: CaptureContext, scope: CaptureScopeRecord) {
  const identity = scopeIdentity(scope);
  return context.sourceScopes.some(candidate => scopeIdentity(candidate) === identity);
}
export function captureScopePredicate(context:CaptureContext,scope:CaptureScopeRecord,at=new Date().toISOString()) {
  if(!snapshotAllowsCapture(context,scope))denied();
  const kind=scope.instrumentHint?.kind??'none';const value=scope.instrumentHint?.value??'';
  const sql=`EXISTS (SELECT 1 FROM device_source_scopes ds
    JOIN source_profiles p ON p.id=ds.source_profile_id AND p.ledger_id=ds.ledger_id
    JOIN accounts a ON a.id=ds.account_id AND a.ledger_id=ds.ledger_id
    JOIN account_currencies ac ON ac.account_id=a.id AND ac.ledger_id=a.ledger_id AND ac.currency=ds.currency
    JOIN source_account_mappings m ON m.source_profile_id=p.id AND m.account_id=a.id AND m.ledger_id=a.ledger_id
      AND m.hint_kind=ds.instrument_hint_kind AND m.hint_value=ds.instrument_hint_value AND m.approval_status='approved'
    WHERE ds.device_id=? AND ds.ledger_id=? AND ds.source_profile_id=? AND ds.account_id=? AND ds.currency=?
      AND ds.instrument_hint_kind=? AND ds.instrument_hint_value=? AND ds.status='approved' AND p.status='approved'
      AND (ds.expires_at IS NULL OR (julianday(ds.expires_at)>julianday('now') AND julianday(ds.expires_at)>julianday(?)))
      AND ((ds.instrument_hint_kind='none' AND ds.instrument_hint_value='') OR EXISTS
        (SELECT 1 FROM source_profile_hints h WHERE h.ledger_id=p.ledger_id AND h.source_profile_id=p.id AND h.hint_kind=ds.instrument_hint_kind AND h.hint_value=ds.instrument_hint_value)))`;
  return {sql,bindings:[context.deviceId,context.ledgerId,scope.sourceProfileId,scope.accountId,scope.currency,kind,value,at]};
}
export async function assertCaptureAuthority(db:D1Database,context:CaptureContext) {
  const guard=captureAuthorityPredicate(context);
  if(!await db.prepare(`SELECT 1 WHERE ${guard.sql}`).bind(...guard.bindings).first())denied();
}
export async function assertCaptureScope(db:D1Database,context:CaptureContext,scope:CaptureScopeRecord,at?:string) {
  await assertCaptureAuthority(db,context);
  const guard=captureScopePredicate(context,scope,at);
  if(!await db.prepare(`SELECT 1 WHERE ${guard.sql}`).bind(...guard.bindings).first())denied();
}
export function capturePublicationGuard(db:D1Database,context:CaptureContext,scope?:CaptureScopeRecord) {
  const authority=captureAuthorityPredicate(context);const permission=scope?captureScopePredicate(context,scope):null;
  return db.prepare(`INSERT INTO ledger_preferences(ledger_id) VALUES (CASE WHEN ${authority.sql}${permission?` AND ${permission.sql}`:''} THEN ? ELSE NULL END) ON CONFLICT(ledger_id) DO NOTHING`)
    .bind(...authority.bindings,...(permission?.bindings??[]),context.ledgerId);
}
