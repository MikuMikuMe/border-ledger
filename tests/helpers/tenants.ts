import type { D1Database } from '../../worker/db-types';
import type { LedgerContext } from '../../worker/tenant-context';
import type { OwnerContext } from '../../worker/mobile-auth';

export const OWNER_LEDGER: LedgerContext = { userId: 'owner', ledgerId: 'personal' };
export const SECOND_LEDGER: LedgerContext = { userId: 'second', ledgerId: 'second-ledger' };

export function tenantOwner(context: LedgerContext): OwnerContext {
  return { ...context, credentialType: 'owner', familyId: `${context.userId}-family`, subjectHash: `${context.userId}-subject`,
    deviceId: null, accessGeneration: 1, scopes: ['ledger:read','imports:write','exports:read','preferences:write'],
    expiresAt: '2099-01-01T00:00:00Z', environmentHash: 'test-environment' };
}

export async function seedTenants(db: D1Database) {
  await db.prepare("INSERT INTO users(id) VALUES ('second')").run();
  await db.prepare("INSERT INTO ledgers(id,user_id) VALUES ('second-ledger','second')").run();
  await db.prepare("INSERT INTO ledger_preferences(ledger_id,reporting_timezone) VALUES ('second-ledger','UTC')").run();
  for (const context of [OWNER_LEDGER, SECOND_LEDGER]) {
    await db.prepare(`INSERT INTO owner_session_families(id,ledger_id,subject_hash,access_generation,refresh_generation,access_expires_at,refresh_expires_at,scope_json,environment_hash)
      VALUES (?,?,?,1,1,'2099-01-01T00:00:00Z','2099-01-01T00:00:00Z',?,'test-environment')`)
      .bind(`${context.userId}-family`,context.ledgerId,`${context.userId}-subject`,JSON.stringify(tenantOwner(context).scopes)).run();
    await db.prepare('INSERT INTO user_identities(issuer,subject,user_id) VALUES (?,?,?)')
      .bind('https://access.example.com', `${context.userId}-subject`, context.userId).run();
    await db.prepare(`INSERT INTO accounts(id,ledger_id,name,institution,currency,kind,status)
      VALUES (?, ?, ?, 'Bank', 'CAD', 'chequing', 'import_only')`).bind(`${context.userId}-account`, context.ledgerId, context.userId).run();
    for (const index of [1, 2]) {
      await db.prepare(`INSERT INTO transactions(id,ledger_id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint)
        VALUES (?,?,?,'2026-10-24',?,?,'CAD','Food','expense','confirmed','manual',?)`)
        .bind(`${context.userId}-tx-${index}`, context.ledgerId, `${context.userId}-account`, context.userId,
          context.userId === 'owner' ? -100 : -900, `${context.userId}-fp-${index}`).run();
    }
  }
}
