import { createD1Fixture, task22MigrationNames } from './helpers/d1';
import { createOwnerSessionFamily, revokeOwnerSessionFamily } from '../worker/owner-session-store';
import { describe, expect, it } from 'vitest';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { authenticateOwner, pkceChallenge, type MobileAuthConfig } from '../worker/mobile-auth';
import { approveOwnerLogin, exchangeOwnerCode, refreshOwnerSession, startOwnerLogin, logoutOwnerSession } from '../worker/mobile-owner-auth';

const config: MobileAuthConfig = {
  canonicalOrigin: 'https://pf.example.com', callbackUrl: 'https://pf.example.com/android/auth/callback',
  environment: 'test', accessAuthorizationUrl: 'https://pf.example.com/authorize',
  sessionEncryptionKey: 'tenant-auth-synthetic-encryption-key',
  approvedAccessIssuers: ['https://access.example.com'], approvedAccessAudiences: ['test-audience'],
  now: () => new Date('2026-10-24T12:00:00Z'),
};
const identity = (subject: string) => ({ issuer: 'https://access.example.com', audience: 'test-audience', subject });
const verifier = 'tenant-auth-test-verifier-012345678901234567890123456789';

async function provision(db: import('../worker/db-types').D1Database) {
  await db.batch([
    db.prepare("INSERT INTO users(id) VALUES ('second')"),
    db.prepare("INSERT INTO ledgers(id, user_id) VALUES ('second-ledger', 'second')"),
    db.prepare("INSERT INTO user_identities(issuer,subject,user_id) VALUES (?, 'owner-login', 'owner')").bind(identity('').issuer),
    db.prepare("INSERT INTO user_identities(issuer,subject,user_id) VALUES (?, 'second-login', 'second')").bind(identity('').issuer),
  ]);
}
async function begin(db: import('../worker/db-types').D1Database) {
  const state = crypto.randomUUID();
  const start = await startOwnerLogin(db, { codeChallenge: await pkceChallenge(verifier), state }, config);
  return { ...start, state };
}
async function login(db: import('../worker/db-types').D1Database, subject: string) {
  const start = await begin(db);
  const approved = await approveOwnerLogin(db, { requestId: start.requestId, identity: identity(subject), consent: true }, config);
  const input = { requestId: start.requestId, code: approved.code, verifier, state: start.state, idempotencyKey: 'same-key' };
  return { tokens: await exchangeOwnerCode(db, input, config), input };
}

describe('provisioned tenant authentication', () => {
  it('begins login without assigning the personal ledger or creating financial state', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await begin(fixture.db);
      expect(await fixture.db.prepare('SELECT COUNT(*) AS count FROM mobile_auth_requests').first('count')).toBe(0);
      expect(await fixture.db.prepare('SELECT COUNT(*) AS count FROM owner_session_families').first('count')).toBe(0);
    } finally { fixture.close(); }
  });
  it('rejects an unknown verified subject without provisioning, even when its email matches an allowlist', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      const start = await begin(fixture.db);
      await expect(approveOwnerLogin(fixture.db, { requestId: start.requestId, identity: { ...identity('unknown'), email: 'owner@example.com' }, consent: true }, { ...config, approvedAccessSubjects: ['owner@example.com'] })).rejects.toThrow('Access is not enabled');
      expect(await fixture.db.prepare('SELECT COUNT(*) AS count FROM users').first('count')).toBe(1);
      expect(await fixture.db.prepare('SELECT COUNT(*) AS count FROM user_identities').first('count')).toBe(0);
    } finally { fixture.close(); }
  });
  it('binds two provisioned identities to their own session families and refresh children', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await provision(fixture.db);
      const first = await login(fixture.db, 'owner-login');
      const second = await login(fixture.db, 'second-login');
      expect(await authenticateOwner(first.tokens.accessToken, fixture.db, config)).toMatchObject({ userId: 'owner', ledgerId: 'personal' });
      expect(await authenticateOwner(second.tokens.accessToken, fixture.db, config)).toMatchObject({ userId: 'second', ledgerId: 'second-ledger' });
      const refreshed = await refreshOwnerSession(fixture.db, { refreshToken: second.tokens.refreshToken, idempotencyKey: 'same-key' }, config);
      expect(await authenticateOwner(refreshed.accessToken, fixture.db, config)).toMatchObject({ userId: 'second', ledgerId: 'second-ledger' });
      const children = await fixture.db.prepare('SELECT DISTINCT r.ledger_id FROM owner_refresh_generations r JOIN owner_session_families f ON f.id = r.family_id WHERE f.ledger_id = ?').bind('second-ledger').all();
      expect(children.results).toEqual([{ ledger_id: 'second-ledger' }]);
    } finally { fixture.close(); }
  });
  it('rejects access, refresh and exchange replay after disabling the user', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await provision(fixture.db);
      const session = await login(fixture.db, 'second-login');
      const refreshInput = { refreshToken: session.tokens.refreshToken, idempotencyKey: 'refresh-retry' };
      const refreshed = await refreshOwnerSession(fixture.db, refreshInput, config);
      await fixture.db.prepare("UPDATE users SET status = 'disabled' WHERE id = 'second'").run();
      await expect(authenticateOwner(refreshed.accessToken, fixture.db, config)).rejects.toThrow();
      await expect(refreshOwnerSession(fixture.db, refreshInput, config)).rejects.toThrow();
      await expect(exchangeOwnerCode(fixture.db, session.input, config)).rejects.toThrow();
    } finally { fixture.close(); }
  });
  it('does not replay exchanged credentials after logout', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await provision(fixture.db);
      const session = await login(fixture.db, 'second-login');
      await logoutOwnerSession(fixture.db, { accessToken: session.tokens.accessToken }, config);
      await expect(exchangeOwnerCode(fixture.db, session.input, config)).rejects.toThrow();
    } finally { fixture.close(); }
  });
  it('cannot reassign an approved login to a second verified identity', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await provision(fixture.db);
      const start = await begin(fixture.db);
      const approved = await approveOwnerLogin(fixture.db, { requestId: start.requestId, identity: identity('owner-login'), consent: true }, config);
      await expect(approveOwnerLogin(fixture.db, { requestId: start.requestId, identity: identity('second-login'), consent: true }, config)).rejects.toThrow();
      const tokens = await exchangeOwnerCode(fixture.db, { requestId: start.requestId, code: approved.code, verifier, state: start.state }, config);
      expect(await authenticateOwner(tokens.accessToken, fixture.db, config)).toMatchObject({ userId: 'owner', ledgerId: 'personal' });
    } finally { fixture.close(); }
  });
  it('cannot revoke another ledger family through the scoped auth store', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await provision(fixture.db);
      await createOwnerSessionFamily(fixture.db, { userId: 'second', ledgerId: 'second-ledger' }, {
        id: 'scoped-family', subjectHash: 'second-owner', accessExpiresAt: '2099-01-01T00:00:00Z', refreshExpiresAt: '2099-01-01T00:00:00Z', refreshTokenHash: 'scoped-refresh-hash',
      });
      await revokeOwnerSessionFamily(fixture.db, { userId: 'owner', ledgerId: 'personal' }, 'scoped-family', '2026-10-24T12:00:00Z');
      expect(await fixture.db.prepare("SELECT revoked_at FROM owner_session_families WHERE id = 'scoped-family'").first('revoked_at')).toBeNull();
    } finally { fixture.close(); }
  });
  it('preserves tenant session and replay bindings in an atomic D1 batch', async () => {
    const fixture = await createD1Fixture(task22MigrationNames);
    try {
      await provision(fixture.db);
      const session = await login(fixture.db, 'second-login');
      const retry = await exchangeOwnerCode(fixture.db, session.input, config);
      expect(retry).toEqual(session.tokens);
      expect(await authenticateOwner(retry.accessToken, fixture.db, config)).toMatchObject({ userId: 'second', ledgerId: 'second-ledger' });
      const refresh = { refreshToken: retry.refreshToken, idempotencyKey: 'd1-retry' };
      const rotated = await refreshOwnerSession(fixture.db, refresh, config);
      expect(await refreshOwnerSession(fixture.db, refresh, config)).toEqual(rotated);
      expect((await fixture.db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    } finally { await fixture.dispose(); }
  });
});
