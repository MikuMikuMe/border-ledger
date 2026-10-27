import { describe, expect, it } from 'vitest';
import { pkceChallenge } from '../worker/mobile-auth';
import { startOwnerLogin } from '../worker/mobile-owner-auth';
import { applyMigrations, createD1Fixture, task18MigrationNames, task22MigrationNames } from './helpers/d1';

const MIGRATION = '0019-owner-installation-binding.sql';

describe('owner installation binding migration', () => {
  it('preserves existing sessions and their refresh children while allowing an unpaired installation', async () => {
    const fixture = await createD1Fixture(task18MigrationNames);
    try {
      await fixture.db.prepare("INSERT INTO mobile_devices (id, ledger_id, device_name, platform, status) VALUES ('legacy-device', 'personal', 'Legacy device', 'android', 'paired')").run();
      await fixture.db.batch([
        fixture.db.prepare("INSERT INTO mobile_auth_requests(id,device_id,state_hash,pkce_challenge_hash,request_digest,expires_at) VALUES ('legacy-request','legacy-device','legacy-state','legacy-challenge','legacy-digest','2099-01-01T00:00:00Z')"),
        fixture.db.prepare("INSERT INTO owner_session_families(id,subject_hash,access_expires_at,refresh_expires_at) VALUES ('legacy-family','legacy-owner','2099-01-01T00:00:00Z','2099-01-01T00:00:00Z')"),
        fixture.db.prepare("INSERT INTO owner_refresh_generations(family_id,generation,token_hash,issued_at,expires_at) VALUES ('legacy-family',1,'legacy-refresh','2026-10-01T00:00:00Z','2099-01-01T00:00:00Z')"),
      ]);
      await fixture.db.prepare("UPDATE owner_session_families SET device_id = 'legacy-device' WHERE id = 'legacy-family'").run();

      await applyMigrations(fixture.db, [MIGRATION]);

      await expect(fixture.db.prepare("SELECT installation_id FROM mobile_auth_requests WHERE id = 'legacy-request'").first()).resolves.toMatchObject({ installation_id: 'legacy-device' });
      await expect(fixture.db.prepare("SELECT installation_id FROM owner_session_families WHERE id = 'legacy-family'").first()).resolves.toMatchObject({ installation_id: 'legacy-device' });
      await expect(fixture.db.prepare("SELECT token_hash FROM owner_refresh_generations WHERE family_id = 'legacy-family'").first()).resolves.toMatchObject({ token_hash: 'legacy-refresh' });
      await applyMigrations(fixture.db, task22MigrationNames);
      const start = await startOwnerLogin(fixture.db, {
        codeChallenge: await pkceChallenge('migration-installation-verifier-012345678901234567890123456789'),
        state: 'migration-installation-state-01234567890123456789', deviceId: 'unpaired-installation',
      }, {
        canonicalOrigin: 'https://pf.example.test', callbackUrl: 'https://pf.example.test/android/auth/callback',
        environment: 'production', accessAuthorizationUrl: 'https://pf.example.test/mobile/authorize',
        sessionEncryptionKey: 'synthetic-migration-session-key',
      });
      await expect(fixture.db.prepare('SELECT installation_id, ledger_id FROM hosted_auth_requests WHERE id = ?').bind(start.requestId).first()).resolves.toMatchObject({ installation_id: 'unpaired-installation', ledger_id: null });
      await expect(fixture.db.prepare('PRAGMA foreign_key_check').all()).resolves.toMatchObject({ results: [] });
    } finally { await fixture.dispose(); }
  });
});
