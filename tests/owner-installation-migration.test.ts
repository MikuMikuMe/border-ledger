import { describe, expect, it } from 'vitest';
import { pkceChallenge } from '../worker/mobile-auth';
import { startOwnerLogin } from '../worker/mobile-owner-auth';
import { createOwnerAuthRequest, createOwnerSessionFamily } from '../worker/owner-session-store';
import { applyMigrations, createD1Fixture, task18MigrationNames } from './helpers/d1';

const MIGRATION = '0019-owner-installation-binding.sql';

describe('owner installation binding migration', () => {
  it('preserves existing sessions and their refresh children while allowing an unpaired installation', async () => {
    const fixture = await createD1Fixture(task18MigrationNames);
    try {
      await fixture.db.prepare("INSERT INTO mobile_devices (id, ledger_id, device_name, platform, status) VALUES ('legacy-device', 'personal', 'Legacy device', 'android', 'paired')").run();
      await createOwnerAuthRequest(fixture.db, {
        id: 'legacy-request', deviceId: 'legacy-device', stateHash: 'legacy-state',
        pkceChallengeHash: 'legacy-challenge', requestDigest: 'legacy-digest', expiresAt: '2099-01-01T00:00:00Z',
      });
      await createOwnerSessionFamily(fixture.db, {
        id: 'legacy-family', subjectHash: 'legacy-owner', accessExpiresAt: '2099-01-01T00:00:00Z',
        refreshExpiresAt: '2099-01-01T00:00:00Z', refreshTokenHash: 'legacy-refresh',
      });
      await fixture.db.prepare("UPDATE owner_session_families SET device_id = 'legacy-device' WHERE id = 'legacy-family'").run();

      await applyMigrations(fixture.db, [MIGRATION]);

      await expect(fixture.db.prepare("SELECT installation_id FROM mobile_auth_requests WHERE id = 'legacy-request'").first()).resolves.toMatchObject({ installation_id: 'legacy-device' });
      await expect(fixture.db.prepare("SELECT installation_id FROM owner_session_families WHERE id = 'legacy-family'").first()).resolves.toMatchObject({ installation_id: 'legacy-device' });
      await expect(fixture.db.prepare("SELECT token_hash FROM owner_refresh_generations WHERE family_id = 'legacy-family'").first()).resolves.toMatchObject({ token_hash: 'legacy-refresh' });
      const start = await startOwnerLogin(fixture.db, {
        codeChallenge: await pkceChallenge('migration-installation-verifier-012345678901234567890123456789'),
        state: 'migration-installation-state-01234567890123456789', deviceId: 'unpaired-installation',
      }, {
        canonicalOrigin: 'https://pf.example.test', callbackUrl: 'https://pf.example.test/android/auth/callback',
        environment: 'production', accessAuthorizationUrl: 'https://pf.example.test/mobile/authorize',
        sessionEncryptionKey: 'synthetic-migration-session-key',
      });
      await expect(fixture.db.prepare('SELECT installation_id, device_id FROM mobile_auth_requests WHERE id = ?').bind(start.requestId).first()).resolves.toMatchObject({ installation_id: 'unpaired-installation', device_id: null });
      await expect(fixture.db.prepare('PRAGMA foreign_key_check').all()).resolves.toMatchObject({ results: [] });
    } finally { await fixture.dispose(); }
  });
});
