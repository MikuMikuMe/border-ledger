import { afterEach, describe, expect, it } from 'vitest';
import { bindConsentedCaptureDevice } from '../worker/mobile-capture-device-binding';
import { hashSecret, type OwnerContext } from '../worker/mobile-auth';
import { applyMigrations, createD1Fixture, task4MigrationNames } from './helpers/d1';

const NOW = '2026-10-20T12:00:00.000Z';
const config = { canonicalOrigin: 'https://pf.example.test', callbackUrl: 'https://pf.example.test/android/auth/callback', environment: 'production', accessAuthorizationUrl: 'https://pf.example.test/mobile/authorize', sessionEncryptionKey: 'synthetic-capture-binding-key', now: () => new Date(NOW) };
const fixtures: Array<{ dispose(): Promise<void> }> = [];
afterEach(async () => { while (fixtures.length) await fixtures.pop()?.dispose(); });

async function setup() {
  const fixture = await createD1Fixture();
  fixtures.push(fixture);
  await applyMigrations(fixture.db, [...task4MigrationNames, '0019-owner-installation-binding.sql']);
  const environmentHash = await hashSecret(config.environment);
  const owner: OwnerContext & { consent: true } = { credentialType: 'owner', ledgerId: 'personal', familyId: 'owner-family', subjectHash: 'owner', deviceId: null, accessGeneration: 1, scopes: ['devices:manage'], expiresAt: '2026-10-20T13:00:00.000Z', environmentHash, consent: true };
  await fixture.db.prepare(`INSERT INTO owner_session_families
    (id, subject_hash, installation_id, access_expires_at, refresh_expires_at, environment_hash)
    VALUES (?, 'owner', 'claimed-installation', ?, '2026-10-21T12:00:00.000Z', ?)`).bind(owner.familyId, owner.expiresAt, environmentHash).run();
  return { ...fixture, owner };
}

describe('explicit-consent capture device binding', () => {
  it('serializes concurrent provisioning and keeps equal installation IDs in separate owner families isolated', async () => {
    const { db, owner } = await setup();
    const first = await Promise.all([
      bindConsentedCaptureDevice(db, owner, config),
      bindConsentedCaptureDevice(db, owner, config),
    ]);
    expect(first[0]).toBe(first[1]);
    expect(first[0]).not.toBe('claimed-installation');
    await expect(db.prepare('SELECT COUNT(*) AS count FROM mobile_devices').first()).resolves.toMatchObject({ count: 1 });
    await db.prepare(`INSERT INTO owner_session_families
      (id, subject_hash, installation_id, access_expires_at, refresh_expires_at, environment_hash)
      VALUES ('other-family', 'owner', 'claimed-installation', ?, '2026-10-21T12:00:00.000Z', ?)`).bind(owner.expiresAt, owner.environmentHash).run();
    const other = await bindConsentedCaptureDevice(db, { ...owner, familyId: 'other-family' }, config);
    expect(other).not.toBe(first[0]);
    await expect(db.prepare('SELECT COUNT(*) AS count FROM mobile_devices').first()).resolves.toMatchObject({ count: 2 });
    await expect(db.prepare('PRAGMA foreign_key_check').all()).resolves.toMatchObject({ results: [] });
  });

  it('creates no capture device for revoked, stale, expired or installation-free sessions', async () => {
    const { db, owner } = await setup();
    const updates = [
      "revoked_at = '2026-10-20T12:00:00.000Z'",
      'revoked_at = NULL, access_generation = 2',
      "access_generation = 1, access_expires_at = '2026-10-20T11:00:00.000Z'",
      "access_expires_at = '2026-10-20T13:00:00.000Z', installation_id = NULL",
    ];
    for (const update of updates) {
      await db.prepare('UPDATE owner_session_families SET ' + update + ' WHERE id = ?').bind(owner.familyId).run();
      await expect(bindConsentedCaptureDevice(db, owner, config)).rejects.toMatchObject({ code: 'device_required' });
    }
    await expect(db.prepare('SELECT COUNT(*) AS count FROM mobile_devices').first()).resolves.toMatchObject({ count: 0 });
  });
});
