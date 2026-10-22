import type { D1Database } from './db-types';
import { MobileAuthError, now, type MobileAuthConfig, type OwnerContext } from './mobile-auth';

const ACTIVE_FAMILY = "id = ? AND ledger_id = 'personal' AND access_generation = ? AND environment_hash = ? AND revoked_at IS NULL AND access_expires_at > ?";
const UNBOUND_INSTALLATION = ACTIVE_FAMILY + ' AND device_id IS NULL AND installation_id IS NOT NULL';

/** Bind a server-generated capture identity only after source validation and explicit consent. */
export async function bindConsentedCaptureDevice(db: D1Database, owner: OwnerContext & { consent: true }, config: MobileAuthConfig) {
  if (owner.deviceId) return owner.deviceId;
  const deviceId = crypto.randomUUID();
  const at = now(config).toISOString();
  const family = [owner.familyId, owner.accessGeneration, owner.environmentHash, at];
  // D1 batches serialize both statements: a competing consent request reuses the winner's binding.
  await db.batch([
    db.prepare(`INSERT INTO mobile_devices (id, ledger_id, device_name, platform, status, paired_at)
      SELECT ?, 'personal', 'Border Ledger Android', 'android', 'paired', ?
      WHERE EXISTS (SELECT 1 FROM owner_session_families WHERE ${UNBOUND_INSTALLATION})`).bind(deviceId, at, ...family),
    db.prepare(`UPDATE owner_session_families SET device_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE ${UNBOUND_INSTALLATION} AND changes() = 1`).bind(deviceId, ...family),
  ]);
  const binding = await db.prepare(`SELECT device_id AS deviceId FROM owner_session_families WHERE ${ACTIVE_FAMILY}`)
    .bind(...family).first<{ deviceId: string | null }>();
  if (!binding?.deviceId) throw new MobileAuthError('device_required', 'An active installation-bound owner session is required.', 403);
  return binding.deviceId;
}
