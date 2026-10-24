import { handleMobileRequest } from '../worker/mobile';
import { describe, expect, it } from 'vitest';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { pkceChallenge, hashSecret, authenticateCapture, type OwnerContext, type MobileAuthConfig } from '../worker/mobile-auth';
import { startPairing, approvePairing, claimPairing, renewCaptureCredential } from '../worker/device-pairing';
const config: MobileAuthConfig = { canonicalOrigin: 'https://pf.example.com', callbackUrl: 'https://pf.example.com/android/auth/callback', environment: 'test', accessAuthorizationUrl: 'https://pf.example.com/mobile/authorize', sessionEncryptionKey: 'synthetic-tenant-pairing-test-key', now: () => new Date('2026-10-24T12:00:00Z'), approvedAccessIssuers: ['https://access.example.com'], approvedAccessAudiences: ['test-audience'] };
const verifier = 'pairing-test-verifier-012345678901234567890123456789';
async function secondUser(db: import('../worker/db-types').D1Database) {
  await db.batch([
    db.prepare("INSERT INTO users(id) VALUES ('second')"),
    db.prepare("INSERT INTO ledgers(id,user_id) VALUES ('second-ledger','second')"),
    db.prepare("INSERT INTO accounts(id,ledger_id,name,institution,currency,kind,status) VALUES ('second-account','second-ledger','Second','Bank','CAD','savings','connected')"),
    db.prepare("INSERT INTO source_profiles(id,ledger_id,provider,source_kind,display_name,parser_version,status) VALUES ('second-source','second-ledger','test','notification','Second','test','approved')"),
    db.prepare("INSERT INTO source_account_mappings(id,ledger_id,source_profile_id,hint_kind,hint_value,account_id,approval_status) VALUES ('second-map','second-ledger','second-source','none','','second-account','approved')"),
  ]);
  const owner: OwnerContext & { consent: true } = { userId: 'second', ledgerId: 'second-ledger', credentialType: 'owner', familyId: 'access-approval', subjectHash: 'verified-second', deviceId: null, accessGeneration: 1, scopes: ['devices:manage'], expiresAt: '2099-01-01T00:00:00Z', environmentHash: await hashSecret(config.environment), consent: true };
  return owner;
}
async function pair(db: import('../worker/db-types').D1Database, owner: OwnerContext & { consent: true }) {
  const started = await startPairing(db, { deviceName: 'Second device', verifierChallenge: await pkceChallenge(verifier) }, config);
  await approvePairing(db, { pairingId: started.pairingId, owner, sourceScopes: [{ sourceProfileId: 'second-source', accountId: 'second-account', currency: 'CAD' }] }, config);
  const claim = { pairingId: started.pairingId, verifier, credentialHash: await hashSecret('second-capture-secret') };
  await claimPairing(db, claim, config);
  return { started, claim };
}
describe('unbound capture pairing', () => {
  it('does not attach an unauthenticated pairing device to the owner ledger', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await startPairing(fixture.db, { deviceName: 'new device', verifierChallenge: await pkceChallenge('pairing-test-verifier-012345678901234567890123456789') }, config);
      expect(await fixture.db.prepare('SELECT COUNT(*) AS count FROM mobile_devices').first('count')).toBe(0);
      expect(await fixture.db.prepare('SELECT COUNT(*) AS count FROM device_pairings').first('count')).toBe(0);
    } finally { fixture.close(); }
  });
  it('binds capture to the approving user and rejects guessed cross-ledger renewal', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      const owner = await secondUser(fixture.db);
      const { started } = await pair(fixture.db, owner);
      expect(await authenticateCapture('second-capture-secret', fixture.db, config)).toMatchObject({ userId: 'second', ledgerId: 'second-ledger', deviceId: started.deviceId });
      await expect(renewCaptureCredential(fixture.db, { owner: { ...owner, userId: 'owner', ledgerId: 'personal' }, deviceId: started.deviceId, credentialHash: await hashSecret('wrong-secret') }, config)).rejects.toThrow();
      expect(await authenticateCapture('second-capture-secret', fixture.db, config)).toMatchObject({ ledgerId: 'second-ledger' });
    } finally { fixture.close(); }
  });
  it('does not replay a claim after credential revocation', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      const owner = await secondUser(fixture.db);
      const { claim } = await pair(fixture.db, owner);
      await fixture.db.prepare("UPDATE capture_credentials SET revoked_at = '2026-10-24T12:00:00Z'").run();
      await expect(claimPairing(fixture.db, claim, config)).rejects.toThrow();
    } finally { fixture.close(); }
  });
  it('rejects another ledger source before binding a pending device', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      const owner = await secondUser(fixture.db);
      const started = await startPairing(fixture.db, { deviceName: 'Unbound', verifierChallenge: await pkceChallenge(verifier) }, config);
      await expect(approvePairing(fixture.db, { pairingId: started.pairingId, owner: { ...owner, userId: 'owner', ledgerId: 'personal' }, sourceScopes: [{ sourceProfileId: 'second-source', accountId: 'second-account', currency: 'CAD' }] }, config)).rejects.toThrow();
      expect(await fixture.db.prepare('SELECT COUNT(*) AS count FROM mobile_devices').first('count')).toBe(0);
    } finally { fixture.close(); }
  });
  it('does not expand an already-approved pairing on a changed approval retry', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      const owner = await secondUser(fixture.db);
      await fixture.db.prepare("INSERT INTO account_currencies(account_id,currency,ledger_id) VALUES ('second-account','USD','second-ledger')").run();
      const started = await startPairing(fixture.db, { deviceName: 'Second', verifierChallenge: await pkceChallenge(verifier) }, config);
      const base = { pairingId: started.pairingId, owner, sourceScopes: [{ sourceProfileId: 'second-source', accountId: 'second-account', currency: 'CAD' }] };
      await approvePairing(fixture.db, base, config);
      await expect(approvePairing(fixture.db, { ...base, sourceScopes: [...base.sourceScopes, { ...base.sourceScopes[0], currency: 'USD' }] }, config)).rejects.toThrow();
      expect((await fixture.db.prepare('SELECT currency FROM device_source_scopes WHERE device_id = ?').bind(started.deviceId).all()).results).toEqual([{ currency: 'CAD' }]);
    } finally { fixture.close(); }
  });
  it('recognizes the same verified approver across browser and native pairing retries', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      const owner = await nativePairingOwner(fixture.db);
      const identity = { issuer: 'https://access.example.com', subject: 'second-login', audience: 'test-audience' };
      owner.subjectHash = await hashSecret(JSON.stringify({ issuer: identity.issuer, subject: identity.subject }));
      await fixture.db.prepare("UPDATE owner_session_families SET subject_hash = ? WHERE id = 'renewal-family'").bind(owner.subjectHash).run();
      await fixture.db.prepare("INSERT INTO user_identities(issuer,subject,user_id) VALUES (?,?,'second')").bind(identity.issuer, identity.subject).run();
      const started = await startPairing(fixture.db, { deviceName: 'Second', verifierChallenge: await pkceChallenge(verifier) }, config);
      const sourceScopes = [{ sourceProfileId: 'second-source', accountId: 'second-account', currency: 'CAD' }];
      const response = await handleMobileRequest(new Request(`https://pf.example.com/api/device-pairings/${started.pairingId}/approval`, {
        method: 'POST', headers: { origin: 'https://pf.example.com', 'content-type': 'application/json' }, body: JSON.stringify({ sourceScopes }),
      }), { DB: fixture.db, LEDGER_APP_ORIGIN: config.canonicalOrigin, MOBILE_ENVIRONMENT: config.environment, MOBILE_CALLBACK_URL: config.callbackUrl,
        MOBILE_ACCESS_AUTHORIZATION_URL: config.accessAuthorizationUrl, MOBILE_SESSION_ENCRYPTION_KEY: config.sessionEncryptionKey,
        MOBILE_APPROVED_ACCESS_ISSUERS: identity.issuer, MOBILE_APPROVED_ACCESS_AUDIENCES: identity.audience, now: config.now }, identity);
      expect(response?.status).toBe(200);
      await expect(approvePairing(fixture.db, { pairingId: started.pairingId, owner, sourceScopes }, config)).resolves.toBeUndefined();
    } finally { fixture.close(); }
  });
  it('rotates capture credentials for an active native family within its tenant', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      const owner = await nativePairingOwner(fixture.db);
      const { started } = await pair(fixture.db, owner);
      const renewed = await renewCaptureCredential(fixture.db, {
        owner, deviceId: started.deviceId, credentialHash: await hashSecret('renewed-secret'),
      }, config);
      expect(renewed).toMatchObject({ state: 'claimed', deviceId: started.deviceId, revocationCapability: expect.any(String) });
      expect(await authenticateCapture('renewed-secret', fixture.db, config))
        .toMatchObject({ userId: 'second', ledgerId: 'second-ledger', deviceId: started.deviceId });
      await expect(authenticateCapture('second-capture-secret', fixture.db, config)).rejects.toThrow();
      expect((await fixture.db.prepare('SELECT ledger_id,generation,revoked_at FROM capture_credentials ORDER BY generation').all()).results)
        .toEqual([{ ledger_id: 'second-ledger', generation: 1, revoked_at: '2026-10-24T12:00:00.000Z' },
          { ledger_id: 'second-ledger', generation: 2, revoked_at: null }]);
    } finally { fixture.close(); }
  });
  it.each([
    "revoked_at = '2026-10-24T11:59:00Z'",
    'access_generation = 2',
    "access_expires_at = '2026-10-24T11:59:00Z'",
  ])('rejects a captured renewal context after family state changes: %s', async (mutation) => {
    const fixture = createSqliteD1Fixture();
    try {
      const owner = await nativePairingOwner(fixture.db);
      const { started } = await pair(fixture.db, owner);
      await fixture.db.prepare(`UPDATE owner_session_families SET ${mutation} WHERE id = 'renewal-family'`).run();
      await expect(renewCaptureCredential(fixture.db, { owner, deviceId: started.deviceId, credentialHash: await hashSecret('new-secret') }, config)).rejects.toThrow();
      expect(await fixture.db.prepare('SELECT COUNT(*) AS count FROM capture_credentials').first('count')).toBe(1);
      expect(await authenticateCapture('second-capture-secret', fixture.db, config)).toMatchObject({ ledgerId: 'second-ledger' });
    } finally { fixture.close(); }
  });
  it('checks the native family inside the renewal publication batch', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      const owner = await nativePairingOwner(fixture.db);
      const { started } = await pair(fixture.db, owner);
      const racedDb = { prepare: fixture.db.prepare.bind(fixture.db), batch: async (statements: import('../worker/db-types').D1Statement[]) => {
        await fixture.db.prepare("UPDATE owner_session_families SET revoked_at = '2026-10-24T11:59:00Z' WHERE id = 'renewal-family'").run();
        return fixture.db.batch(statements);
      } };
      await expect(renewCaptureCredential(racedDb, { owner, deviceId: started.deviceId, credentialHash: await hashSecret('raced-secret') }, config)).rejects.toThrow();
      expect(await fixture.db.prepare('SELECT COUNT(*) AS count FROM capture_credentials').first('count')).toBe(1);
      expect(await authenticateCapture('second-capture-secret', fixture.db, config)).toMatchObject({ ledgerId: 'second-ledger' });
    } finally { fixture.close(); }
  });
});

async function nativePairingOwner(db: import('../worker/db-types').D1Database) {
  const owner = await secondUser(db);
  await db.prepare(`INSERT INTO owner_session_families(id,ledger_id,subject_hash,access_generation,refresh_generation,access_expires_at,refresh_expires_at,scope_json,environment_hash)
    VALUES ('renewal-family','second-ledger',?,1,1,'2099-01-01T00:00:00Z','2099-01-01T00:00:00Z','["devices:manage"]',?)`).bind(owner.subjectHash, owner.environmentHash).run();
  return { ...owner, familyId: 'renewal-family' };
}
