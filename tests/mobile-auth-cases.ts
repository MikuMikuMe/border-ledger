import assert from 'node:assert/strict';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import {
  CAPTURE_SCOPE,
  OWNER_SCOPES,
  authorizeMobileRoute,
  authenticateCapture,
  authenticateOwner,
  authenticateRevocation,
  isoAfter,
  hashSecret,
  isMobileCredential,
  pkceChallenge,
  revokeGrantByCapability,
  type MobileAuthConfig,
} from '../worker/mobile-auth';
import {
  approveOwnerLogin,
  exchangeOwnerCode,
  refreshOwnerSession,
  startOwnerLogin,
  logoutOwnerSession,
  type OwnerTokenResponse,
} from '../worker/mobile-owner-auth';
import {
  approvePairing,
  assertCaptureEventScope,
  claimPairing,
  renewCaptureCredential,
  startPairing,
} from '../worker/device-pairing';
import { issueSecureCaptureCredential } from '../worker/device-store';

const INITIAL_NOW = Date.parse('2026-10-13T12:00:00.000Z');
const OWNER_SUBJECT = 'synthetic-owner-subject';
const OWNER_VERIFIER = 'synthetic-owner-pkce-verifier-012345678901234567890123456789';
const PAIR_VERIFIER = 'synthetic-pair-verifier-012345678901234567890123456789';
const CALLBACK_URL = 'https://pf.example.com/android/auth/callback';

function makeClock() {
  let now = INITIAL_NOW;
  return {
    now: () => new Date(now),
    advance(ms: number) { now += ms; },
    value() { return now; },
  };
}

function config(clock: ReturnType<typeof makeClock>): MobileAuthConfig {
  return {
    canonicalOrigin: 'https://pf.example.com',
    callbackUrl: CALLBACK_URL,
    environment: 'sandbox',
    accessAuthorizationUrl: 'https://access.example.com/authorize/native',
    sessionEncryptionKey: 'synthetic-task-4-session-key-never-a-production-secret',
    approvedAccessIssuers: ['https://team.cloudflareaccess.com'],
    approvedAccessAudiences: ['synthetic-mobile-audience'],
    approvedAccessSubjects: [OWNER_SUBJECT],
    now: clock.now,
  };
}

async function seedLedger(db: import('../worker/db-types').D1Database) {
  await db.batch([
    db.prepare('INSERT INTO accounts (id, name, institution, currency, currency_mode, kind, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind('account-boc', 'Synthetic BOC credit', 'BOC', 'CAD', 'multi', 'credit', 'connected'),
    db.prepare('INSERT OR IGNORE INTO account_currencies (account_id, currency) VALUES (?, ?)').bind('account-boc', 'CAD'),
    db.prepare('INSERT OR IGNORE INTO account_currencies (account_id, currency) VALUES (?, ?)').bind('account-boc', 'USD'),
    db.prepare('INSERT INTO source_profiles (id, ledger_id, provider, source_kind, display_name, parser_version, status, config_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind('source-boc', 'personal', 'boc', 'wechat', 'Synthetic BOC', 'task4', 'approved', '{}'),
    db.prepare('INSERT INTO source_account_mappings (id, ledger_id, source_profile_id, hint_kind, hint_value, account_id, approval_status, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind('mapping-boc', 'personal', 'source-boc', 'card_suffix', '1234', 'account-boc', 'approved', '2026-10-13T11:00:00.000Z'),
    db.prepare('INSERT INTO source_account_mappings (id, ledger_id, source_profile_id, hint_kind, hint_value, account_id, approval_status, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind('mapping-boc-2', 'personal', 'source-boc', 'card_suffix', '5678', 'account-boc', 'approved', '2026-10-13T11:00:00.000Z'),
  ]);
}

async function seedDevice(db: import('../worker/db-types').D1Database, id: string) {
  await db.prepare('INSERT OR IGNORE INTO mobile_devices (id, ledger_id, device_name, platform, status) VALUES (?, ?, ?, ?, ?)')
    .bind(id, 'personal', `Synthetic ${id}`, 'android', 'paired').run();
}

async function beginAndApproveOwner(db: import('../worker/db-types').D1Database, cfg: MobileAuthConfig, deviceId = 'owner-device') {
  const verifier = OWNER_VERIFIER + deviceId;
  const challenge = await pkceChallenge(verifier);
  const state = `state-${deviceId}-${'x'.repeat(32)}`;
  const start = await startOwnerLogin(db, {
    codeChallenge: challenge,
    state,
    deviceId,
    environment: cfg.environment,
    callbackUrl: cfg.callbackUrl,
  }, cfg);
  const approval = await approveOwnerLogin(db, {
    requestId: start.requestId,
    identity: {
      subject: OWNER_SUBJECT,
      issuer: 'https://team.cloudflareaccess.com',
      audience: 'synthetic-mobile-audience',
    },
    environment: cfg.environment,
    callbackUrl: cfg.callbackUrl,
    consent: true,
  }, cfg);
  return { verifier, challenge, state, start, approval };
}

async function exchange(db: import('../worker/db-types').D1Database, cfg: MobileAuthConfig, flow: Awaited<ReturnType<typeof beginAndApproveOwner>>, staySignedIn = false) {
  return exchangeOwnerCode(db, {
    requestId: flow.start.requestId,
    code: flow.approval.code,
    verifier: flow.verifier,
    state: flow.state,
    environment: cfg.environment,
    callbackUrl: cfg.callbackUrl,
    deviceId: flow.start.deviceId,
    staySignedIn,
    idempotencyKey: `exchange-${flow.start.requestId}`,
  }, cfg);
}

async function expectReject(action: () => Promise<unknown>, pattern: RegExp) {
  await assert.rejects(action, (error: unknown) => {
    assert.match(error instanceof Error ? error.message : String(error), pattern);
    return true;
  });
}

// Exercise migrated families whose capture association predates installation bindings.
async function legacyCaptureOwner(db: import('../worker/db-types').D1Database, accessToken: string, cfg: MobileAuthConfig, deviceId: string) {
  const owner = await authenticateOwner(accessToken, db, cfg, 'devices:manage');
  await db.prepare('UPDATE owner_session_families SET device_id = ?, installation_id = NULL WHERE id = ?')
    .bind(deviceId, owner.familyId).run();
  const legacy = await authenticateOwner(accessToken, db, cfg, 'devices:manage');
  assert.equal(legacy.deviceId, deviceId);
  return legacy;
}

export async function runTask4Cases() {
  const fixture = createSqliteD1Fixture();
  const clock = makeClock();
  const cfg = config(clock);
  try {
    await seedLedger(fixture.db);
    await fixture.db.prepare('INSERT INTO mobile_devices (id, ledger_id, device_name, platform, status) VALUES (?, ?, ?, ?, ?)')
      .bind('owner-device', 'personal', 'Synthetic owner phone', 'android', 'paired').run();

    const ownerFlow = await beginAndApproveOwner(fixture.db, cfg);
    assert.equal(ownerFlow.start.expiresAt, '2026-10-13T12:10:00.000Z');
    const authorizationUrl = new URL(ownerFlow.start.authorizationUrl);
    assert.equal(authorizationUrl.searchParams.get('request_id'), ownerFlow.start.requestId);
    assert.equal(authorizationUrl.searchParams.get('state'), ownerFlow.state);
    assert.equal(ownerFlow.approval.expiresAt, '2026-10-13T12:01:00.000Z');

    const duplicateApproval = await approveOwnerLogin(fixture.db, {
      requestId: ownerFlow.start.requestId,
      identity: {
        subject: OWNER_SUBJECT,
        issuer: 'https://team.cloudflareaccess.com',
        audience: 'synthetic-mobile-audience',
      },
      environment: cfg.environment,
      callbackUrl: cfg.callbackUrl,
      consent: true,
    }, cfg);
    assert.deepEqual(duplicateApproval, ownerFlow.approval);

    const storedRequest = await fixture.db.prepare('SELECT state_hash, pkce_challenge_hash, code_hash, approved_subject_hash, callback_origin, callback_path FROM mobile_auth_requests WHERE id = ?')
      .bind(ownerFlow.start.requestId).all<Record<string, string>>();
    assert.equal(storedRequest.results.length, 1);
    assert.notEqual(storedRequest.results[0].state_hash, ownerFlow.state);
    assert.notEqual(storedRequest.results[0].pkce_challenge_hash, ownerFlow.challenge);
    assert.notEqual(storedRequest.results[0].code_hash, ownerFlow.approval.code);
    assert.equal(storedRequest.results[0].callback_origin, cfg.canonicalOrigin);
    assert.equal(storedRequest.results[0].callback_path, '/android/auth/callback');

    await expectReject(() => approveOwnerLogin(fixture.db, {
      requestId: ownerFlow.start.requestId,
      identity: { subject: 'unapproved', issuer: 'https://team.cloudflareaccess.com', audience: 'synthetic-mobile-audience' },
      environment: cfg.environment,
      callbackUrl: cfg.callbackUrl,
      consent: true,
    }, cfg), /approved|identity/i);

    await expectReject(() => exchangeOwnerCode(fixture.db, {
      requestId: ownerFlow.start.requestId,
      code: ownerFlow.approval.code,
      verifier: 'wrong-verifier-' + 'x'.repeat(43),
      state: ownerFlow.state,
      environment: cfg.environment,
      callbackUrl: cfg.callbackUrl,
      deviceId: 'owner-device',
      idempotencyKey: 'wrong-verifier',
    }, cfg), /verifier|PKCE/i);
    await expectReject(() => exchangeOwnerCode(fixture.db, {
      requestId: ownerFlow.start.requestId,
      code: ownerFlow.approval.code,
      verifier: ownerFlow.verifier,
      state: 'wrong-state-' + 'x'.repeat(32),
      environment: cfg.environment,
      callbackUrl: cfg.callbackUrl,
      deviceId: 'owner-device',
      idempotencyKey: 'wrong-state',
    }, cfg), /state/i);
    await expectReject(() => exchangeOwnerCode(fixture.db, {
      requestId: ownerFlow.start.requestId,
      code: ownerFlow.approval.code,
      verifier: ownerFlow.verifier,
      state: ownerFlow.state,
      environment: cfg.environment,
      callbackUrl: 'https://evil.example/callback',
      deviceId: 'owner-device',
      idempotencyKey: 'wrong-host',
    }, cfg), /callback|host|origin/i);
    await expectReject(() => exchangeOwnerCode(fixture.db, {
      requestId: ownerFlow.start.requestId,
      code: ownerFlow.approval.code,
      verifier: ownerFlow.verifier,
      state: ownerFlow.state,
      environment: cfg.environment,
      callbackUrl: 'https://pf.example.com/android/auth/wrong-callback',
      deviceId: 'owner-device',
      idempotencyKey: 'wrong-path',
    }, cfg), /callback|path/i);
    await expectReject(() => exchangeOwnerCode(fixture.db, {
      requestId: ownerFlow.start.requestId,
      code: ownerFlow.approval.code,
      verifier: ownerFlow.verifier,
      state: ownerFlow.state,
      environment: 'production',
      callbackUrl: cfg.callbackUrl,
      deviceId: 'owner-device',
      idempotencyKey: 'wrong-environment',
    }, cfg), /environment/i);

    const owner = await exchange(fixture.db, cfg, ownerFlow);
    assert.deepEqual(owner.scopes, [...OWNER_SCOPES]);
    assert.equal(Date.parse(owner.expiresAt) - clock.value(), 15 * 60 * 1000);
    assert.equal(owner.revocationCapability.length > 40, true);
    const family = await fixture.db.prepare('SELECT refresh_expires_at, stay_signed_in_until, scope_json, revocation_capability_hash FROM owner_session_families').all<Record<string, string | null>>();
    assert.equal(Date.parse(family.results[0].refresh_expires_at as string) - clock.value(), 24 * 60 * 60 * 1000);
    assert.equal(family.results[0].stay_signed_in_until, null);
    assert.equal(family.results[0].scope_json, JSON.stringify(OWNER_SCOPES));
    assert.notEqual(family.results[0].revocation_capability_hash, owner.revocationCapability);

    const replayedExchange = await exchange(fixture.db, cfg, ownerFlow);
    assert.deepEqual(replayedExchange, owner);
    clock.advance(60_001);
    await expectReject(() => exchange(fixture.db, cfg, ownerFlow), /consumed|expired|replay/i);
    clock.advance(60_001);

    await seedDevice(fixture.db, 'owner-device-expired-code');
    const expiredCodeFlow = await beginAndApproveOwner(fixture.db, cfg, 'owner-device-expired-code');
    clock.advance(120_001);
    await expectReject(() => exchange(fixture.db, cfg, expiredCodeFlow), /expired|code/i);

    const ownerContext = await authenticateOwner(owner.accessToken, fixture.db, cfg, 'ledger:read');
    assert.equal(ownerContext.ledgerId, 'personal');
    assert.equal(ownerContext.credentialType, 'owner');
    assert.equal(isMobileCredential(owner.accessToken), true);
    authorizeMobileRoute(ownerContext, '/api/mobile/v1/accounts', 'ledger:read');

    const rotated = await refreshOwnerSession(fixture.db, {
      refreshToken: owner.refreshToken,
      environment: cfg.environment,
      idempotencyKey: 'refresh-1',
    }, cfg);
    const refreshReplay = await refreshOwnerSession(fixture.db, {
      refreshToken: owner.refreshToken,
      environment: cfg.environment,
      idempotencyKey: 'refresh-1',
    }, cfg);
    assert.deepEqual(refreshReplay, rotated);
    clock.advance(60_001);
    await expectReject(() => refreshOwnerSession(fixture.db, {
      refreshToken: owner.refreshToken,
      environment: cfg.environment,
      idempotencyKey: 'refresh-1',
    }, cfg), /replay|reuse|revoked/i);
    await expectReject(() => authenticateOwner(rotated.accessToken, fixture.db, cfg, 'ledger:read'), /revoked|session/i);

    await seedDevice(fixture.db, 'owner-device-2');
    const secondFlow = await beginAndApproveOwner(fixture.db, cfg, 'owner-device-2');
    const secondOwner = await exchange(fixture.db, cfg, secondFlow, true);
    assert.equal(Date.parse(secondOwner.expiresAt) - clock.value(), 15 * 60 * 1000);
    const twoFamilies = await fixture.db.prepare('SELECT refresh_expires_at, stay_signed_in_until FROM owner_session_families ORDER BY refresh_expires_at DESC LIMIT 1').all<Record<string, string>>();
    assert.equal(Date.parse(twoFamilies.results[0].refresh_expires_at) - clock.value(), 30 * 24 * 60 * 60 * 1000);
    assert.equal(Date.parse(twoFamilies.results[0].stay_signed_in_until) - clock.value(), 30 * 24 * 60 * 60 * 1000);

    const pairing = await startPairing(fixture.db, {
      deviceName: 'Synthetic capture phone',
      platform: 'android',
      verifierChallenge: await pkceChallenge(PAIR_VERIFIER),
      environment: cfg.environment,
    }, cfg);
    assert.match(pairing.userCode, /^[A-HJ-NP-Z2-9]{8}$/);
    const pending = await claimPairing(fixture.db, {
      pairingId: pairing.pairingId,
      verifier: PAIR_VERIFIER,
      credentialHash: await hashSecret('capture-secret-1'),
      environment: cfg.environment,
    }, cfg);
    assert.equal(pending.state, 'pending');

    const capturePairing = await startPairing(fixture.db, {
      deviceName: 'Synthetic capture phone 2',
      platform: 'android',
      verifierChallenge: await pkceChallenge(PAIR_VERIFIER + '-2'),
      environment: cfg.environment,
    }, cfg);
    const secondContext = await authenticateOwner(secondOwner.accessToken, fixture.db, cfg, 'devices:manage');
    await approvePairing(fixture.db, {
      pairingId: capturePairing.pairingId,
      owner: { ...secondContext, consent: true },
      environment: cfg.environment,
      sourceScopes: [
        { sourceProfileId: 'source-boc', accountId: 'account-boc', currency: 'CAD', instrumentHint: { kind: 'card_suffix', value: '1234' } },
        { sourceProfileId: 'source-boc', accountId: 'account-boc', currency: 'CAD', instrumentHint: { kind: 'card_suffix', value: '5678' } },
      ],
    }, cfg);
    const credentialHash = await hashSecret('capture-secret-2');
    const claimed = await claimPairing(fixture.db, {
      pairingId: capturePairing.pairingId,
      verifier: PAIR_VERIFIER + '-2',
      credentialHash,
      environment: cfg.environment,
    }, cfg);
    assert.equal(claimed.state, 'claimed');
    assert.equal(Date.parse(claimed.credentialExpiresAt as string) - clock.value(), 90 * 24 * 60 * 60 * 1000);
    const pairedScopes = await fixture.db.prepare(`SELECT account_id, currency, instrument_hint_kind, instrument_hint_value
      FROM device_source_scopes WHERE device_id = ? ORDER BY instrument_hint_value`).bind(capturePairing.deviceId).all<{
      account_id: string;
      currency: string;
      instrument_hint_kind: string;
      instrument_hint_value: string;
    }>();
    assert.deepEqual(pairedScopes.results.map((row) => ({ ...row })), [
      { account_id: 'account-boc', currency: 'CAD', instrument_hint_kind: 'card_suffix', instrument_hint_value: '1234' },
      { account_id: 'account-boc', currency: 'CAD', instrument_hint_kind: 'card_suffix', instrument_hint_value: '5678' },
    ]);
    const claimedAgain = await claimPairing(fixture.db, {
      pairingId: capturePairing.pairingId,
      verifier: PAIR_VERIFIER + '-2',
      credentialHash,
      environment: cfg.environment,
    }, cfg);
    assert.deepEqual(claimedAgain, claimed);
    await expectReject(async () => claimPairing(fixture.db, {
      pairingId: capturePairing.pairingId,
      verifier: PAIR_VERIFIER + '-2',
      credentialHash: await hashSecret('capture-secret-conflict'),
      environment: cfg.environment,
    }, cfg), /claimed|conflict|different/i);

    await fixture.db.batch([
      fixture.db.prepare('INSERT INTO accounts (id, name, institution, currency, currency_mode, kind, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind('account-boc-collision', 'Synthetic BOC debit', 'BOC', 'CAD', 'multi', 'debit', 'connected'),
      fixture.db.prepare('INSERT OR IGNORE INTO account_currencies (account_id, currency) VALUES (?, ?)').bind('account-boc-collision', 'CAD'),
      fixture.db.prepare('INSERT INTO source_account_mappings (id, ledger_id, source_profile_id, hint_kind, hint_value, account_id, approval_status, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind('mapping-boc-collision', 'personal', 'source-boc', 'card_suffix', '1234', 'account-boc-collision', 'approved', '2026-10-13T12:00:00.000Z'),
    ]);
    const collisionPairing = await startPairing(fixture.db, {
      deviceName: 'Synthetic collision phone',
      platform: 'android',
      verifierChallenge: await pkceChallenge(PAIR_VERIFIER + '-collision'),
      environment: cfg.environment,
    }, cfg);
    await expectReject(() => approvePairing(fixture.db, {
      pairingId: collisionPairing.pairingId,
      owner: { ...secondContext, consent: true },
      environment: cfg.environment,
      sourceScopes: [{ sourceProfileId: 'source-boc', accountId: 'account-boc', currency: 'CAD', hintKind: 'card_suffix', hintValue: '1234' }],
    }, cfg), /ambiguous|collision|review|hint/i);
    const collisionStatus = await fixture.db.prepare('SELECT status FROM device_pairings WHERE id = ?')
      .bind(collisionPairing.pairingId).all<{ status: string }>();
    assert.equal(collisionStatus.results[0].status, 'pending');

    const capture = await authenticateCapture('capture-secret-2', fixture.db, cfg);
    assert.equal(capture.scope, CAPTURE_SCOPE);
    authorizeMobileRoute(capture, '/api/mobile/v1/status', CAPTURE_SCOPE);
    assert.throws(() => authorizeMobileRoute(capture, '/api/mobile/v1/accounts', 'ledger:read'), /scope|capture|forbidden/i);
    await expectReject(() => authenticateOwner('capture-secret-2', fixture.db, cfg, 'ledger:read'), /credential|owner|invalid/i);
    await expectReject(() => authenticateCapture(owner.accessToken, fixture.db, cfg), /credential|capture|invalid/i);
    await assertCaptureEventScope(fixture.db, capture, { sourceProfileId: 'source-boc', accountId: 'account-boc', currency: 'CAD', instrumentHint: { kind: 'card_suffix', value: '1234' } });
    await assertCaptureEventScope(fixture.db, capture, { sourceProfileId: 'source-boc', accountId: 'account-boc', currency: 'CAD', instrumentHint: { kind: 'card_suffix', value: '5678' } });
    await expectReject(() => assertCaptureEventScope(fixture.db, capture, { sourceProfileId: 'source-boc', accountId: 'account-boc', currency: 'CAD', instrumentHint: { kind: 'card_suffix', value: '9999' } }), /scope|approved/i);
    await expectReject(() => assertCaptureEventScope(fixture.db, capture, { sourceProfileId: 'source-boc', accountId: 'account-boc', currency: 'USD' }), /scope|currency|approved/i);

    const oldRevocation = owner.revocationCapability;
    await expectReject(() => authenticateRevocation(oldRevocation, fixture.db, cfg), /current|revocation/i);
    const currentRevocation = secondOwner.revocationCapability;
    const revocationContext = await authenticateRevocation(currentRevocation, fixture.db, cfg);
    assert.throws(() => authorizeMobileRoute(revocationContext, '/api/mobile/v1/accounts', 'ledger:read'), /scope|revocation|forbidden/i);
    await revokeGrantByCapability(currentRevocation, fixture.db, cfg);
    await expectReject(() => authenticateOwner(secondOwner.accessToken, fixture.db, cfg, 'ledger:read'), /revoked|session/i);
    await revokeGrantByCapability(currentRevocation, fixture.db, cfg);

    await seedDevice(fixture.db, 'owner-device-3');
    const thirdFlow = await beginAndApproveOwner(fixture.db, cfg, 'owner-device-3');
    const thirdOwner = await exchange(fixture.db, cfg, thirdFlow);
    await logoutOwnerSession(fixture.db, { accessToken: thirdOwner.accessToken }, cfg);
    await logoutOwnerSession(fixture.db, { accessToken: thirdOwner.accessToken }, cfg);
    await expectReject(() => authenticateOwner(thirdOwner.accessToken, fixture.db, cfg, 'ledger:read'), /revoked|session/i);

    await seedDevice(fixture.db, 'owner-device-4');
    const fourthFlow = await beginAndApproveOwner(fixture.db, cfg, 'owner-device-4');
    const fourthOwner = await exchange(fixture.db, cfg, fourthFlow);
    const fourthContext = await legacyCaptureOwner(fixture.db, fourthOwner.accessToken, cfg, 'owner-device-4');
    const originalCaptureSecret = 'owner-device-4-capture-v1';
    const renewedCaptureSecret = 'owner-device-4-capture-v2';
    const captureIssuedAt = new Date(clock.value()).toISOString();
    await issueSecureCaptureCredential(fixture.db, {
      id: 'capture-owner-device-4-v1',
      deviceId: 'owner-device-4',
      credentialHash: await hashSecret(originalCaptureSecret),
      generation: 1,
      issuedAt: captureIssuedAt,
      expiresAt: isoAfter(new Date(clock.value()), 90 * 24 * 60 * 60 * 1000),
      environmentHash: await hashSecret(cfg.environment),
      revocationCapabilityHash: 'synthetic-old-capture-revocation-hash',
    });
    const renewedCapture = await renewCaptureCredential(fixture.db, {
      owner: { ...fourthContext, consent: true },
      deviceId: 'owner-device-4',
      credentialHash: await hashSecret(renewedCaptureSecret),
      environment: cfg.environment,
    }, cfg);
    assert.equal(renewedCapture.state, 'claimed');
    const fourthRotated = await refreshOwnerSession(fixture.db, {
      refreshToken: fourthOwner.refreshToken,
      environment: cfg.environment,
      idempotencyKey: 'refresh-fourth-owner',
    }, cfg);
    await expectReject(() => logoutOwnerSession(fixture.db, { accessToken: fourthOwner.accessToken }, cfg), /revoked|session|current/i);
    await assert.doesNotReject(() => authenticateCapture(renewedCaptureSecret, fixture.db, cfg));
    const renewedCaptureRow = await fixture.db.prepare('SELECT generation, revoked_at FROM capture_credentials WHERE device_id = ? ORDER BY generation DESC LIMIT 1')
      .bind('owner-device-4').all<{ generation: number; revoked_at: string | null }>();
    assert.equal(renewedCaptureRow.results.length, 1);
    assert.equal(renewedCaptureRow.results[0].generation, 2);
    assert.equal(renewedCaptureRow.results[0].revoked_at, null);
    await logoutOwnerSession(fixture.db, { accessToken: fourthRotated.accessToken }, cfg);
    await logoutOwnerSession(fixture.db, { accessToken: fourthRotated.accessToken }, cfg);
    await expectReject(() => authenticateCapture(renewedCaptureSecret, fixture.db, cfg), /revoked|expired/i);

    const schemaRows = await fixture.db.prepare('SELECT credential_type, scope, revocation_capability_hash FROM capture_credentials').all<Record<string, string>>();
    assert.equal(schemaRows.results[0].credential_type, 'capture');
    assert.equal(schemaRows.results[0].scope, CAPTURE_SCOPE);
    assert.notEqual(schemaRows.results[0].revocation_capability_hash, claimed.revocationCapability);
  } finally {
    fixture.close();
  }
}
