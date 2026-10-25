import type { D1Database } from './db-types';
import type { FinancialContext } from './financial-authority';
import type { SourceMappingInput, SourceConfigInput } from './mobile-device-service';

/** Fail the entire D1 batch instead of silently skipping a protected mutation. */
export function devicePublicationGuard(db:D1Database, context:FinancialContext, predicate:string, bindings:unknown[]) {
  return db.prepare(`INSERT INTO ledger_preferences(ledger_id) VALUES (CASE WHEN ${predicate} THEN ? ELSE NULL END)
    ON CONFLICT(ledger_id) DO NOTHING`).bind(...bindings,context.ledgerId);
}

export function approvedSourceMapping(context:FinancialContext, mapping:SourceMappingInput, currency:string) {
  const hintKind=mapping.instrumentHint?.kind ?? 'none';
  const hintValue=mapping.instrumentHint?.value ?? '';
  return {
    sql:`EXISTS (SELECT 1 FROM source_profiles p JOIN source_account_mappings m ON m.source_profile_id=p.id AND m.ledger_id=p.ledger_id
      JOIN accounts a ON a.id=m.account_id AND a.ledger_id=m.ledger_id
      JOIN account_currencies c ON c.account_id=a.id AND c.ledger_id=a.ledger_id
      WHERE p.id=? AND p.ledger_id=? AND p.status='approved' AND m.approval_status='approved'
      AND a.id=? AND c.currency=? AND m.hint_kind=? AND m.hint_value=?
      AND (?='none' OR EXISTS (SELECT 1 FROM source_profile_hints h WHERE h.ledger_id=p.ledger_id AND h.source_profile_id=p.id AND h.hint_kind=? AND h.hint_value=?)))`,
    bindings:[mapping.sourceProfileId,context.ledgerId,mapping.accountId,currency,hintKind,hintValue,hintKind,hintKind,hintValue],
  };
}

export function sourceConfigStatements(db:D1Database, context:FinancialContext, deviceId:string, config:SourceConfigInput) {
  const scopes=config.mappings.flatMap(mapping=>mapping.allowedCurrencies.map(currency=>({mapping,currency})));
  return [
    devicePublicationGuard(db,context,`EXISTS (SELECT 1 FROM mobile_devices WHERE id=? AND ledger_id=? AND status='paired' AND revoked_at IS NULL AND source_config_revision=?)`,[deviceId,context.ledgerId,config.expectedRevision]),
    ...scopes.map(({mapping,currency})=>{const approved=approvedSourceMapping(context,mapping,currency);return devicePublicationGuard(db,context,approved.sql,approved.bindings);}),
    db.prepare('UPDATE mobile_devices SET source_config_revision=source_config_revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND ledger_id=?').bind(deviceId,context.ledgerId),
    db.prepare('DELETE FROM device_source_scopes WHERE device_id=? AND ledger_id=?').bind(deviceId,context.ledgerId),
    ...scopes.map(({mapping,currency})=>db.prepare(`INSERT INTO device_source_scopes
      (id,ledger_id,device_id,source_profile_id,account_id,currency,instrument_hint_kind,instrument_hint_value,status)
      VALUES (?,?,?,?,?,?,?,?,'approved')`).bind(crypto.randomUUID(),context.ledgerId,deviceId,mapping.sourceProfileId,mapping.accountId,currency,mapping.instrumentHint?.kind??'none',mapping.instrumentHint?.value??'')),
  ];
}
