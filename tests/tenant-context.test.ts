import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { provisionOwnerIdentityBindings, resolveLedgerContext } from '../worker/tenant-context';

const fixtures: Array<{ close(): void }> = [];
afterEach(() => { while (fixtures.length) fixtures.pop()?.close(); });
function fixture() { const result = createSqliteD1Fixture(); fixtures.push(result); return result.db; }
const ownerIdentity = { issuer: 'https://access.example.test', subject: 'owner-subject' };

describe('closed hosted identity resolution', () => {
  it('resolves only explicitly provisioned verified identities, including multiple owner bindings', async () => {
    const db = fixture();
    const native = { issuer: 'https://native.example.test', subject: 'native-owner' };
    await provisionOwnerIdentityBindings(db, [ownerIdentity, native]);
    await provisionOwnerIdentityBindings(db, [ownerIdentity, native]);
    for (const identity of [ownerIdentity, native]) {
      await expect(resolveLedgerContext(db, identity)).resolves.toEqual({ userId: 'owner', ledgerId: 'personal' });
    }
    expect(await db.prepare('SELECT COUNT(*) AS count FROM user_identities').first()).toEqual({ count: 2 });
  });

  it('rejects unknown subjects and issuers without creating identity or ledger state', async () => {
    const db = fixture();
    await provisionOwnerIdentityBindings(db, [ownerIdentity]);
    for (const identity of [{ ...ownerIdentity, subject: 'unknown' }, { ...ownerIdentity, issuer: 'https://other.example.test' }]) {
      await expect(resolveLedgerContext(db, identity)).rejects.toThrow('Access is not enabled');
    }
    expect(await db.prepare('SELECT COUNT(*) AS count FROM users').first()).toEqual({ count: 1 });
    expect(await db.prepare('SELECT COUNT(*) AS count FROM ledgers').first()).toEqual({ count: 1 });
    expect(await db.prepare('SELECT COUNT(*) AS count FROM user_identities').first()).toEqual({ count: 1 });
  });

  it('rejects disabled users and provisioning never re-enables them', async () => {
    const db = fixture();
    await provisionOwnerIdentityBindings(db, [ownerIdentity]);
    await db.prepare("UPDATE users SET status = 'disabled' WHERE id = 'owner'").run();
    await expect(resolveLedgerContext(db, ownerIdentity)).rejects.toThrow('Access is not enabled');
    await expect(provisionOwnerIdentityBindings(db, [ownerIdentity])).rejects.toThrow();
    expect(await db.prepare("SELECT status FROM users WHERE id = 'owner'").first()).toEqual({ status: 'disabled' });
  });

  it('refuses a binding already owned by another user and rolls back the complete batch', async () => {
    const db = fixture();
    await db.prepare("INSERT INTO users (id) VALUES ('second')").run();
    await db.prepare("INSERT INTO ledgers (id, user_id) VALUES ('second-ledger', 'second')").run();
    await db.prepare('INSERT INTO user_identities (issuer, subject, user_id) VALUES (?, ?, ?)')
      .bind(ownerIdentity.issuer, ownerIdentity.subject, 'second').run();
    await expect(provisionOwnerIdentityBindings(db, [{ issuer: 'https://fresh.example.test', subject: 'fresh' }, ownerIdentity])).rejects.toThrow();
    expect(await db.prepare('SELECT issuer, subject, user_id FROM user_identities').all()).toEqual({ results: [{ ...ownerIdentity, user_id: 'second' }] });
  });

  it('refuses inconsistent owner ledger mappings and empty bindings', async () => {
    const db = fixture();
    await expect(provisionOwnerIdentityBindings(db, [])).rejects.toThrow();
    await expect(provisionOwnerIdentityBindings(db, [{ issuer: '', subject: 'owner' }])).rejects.toThrow();
    await db.prepare("DELETE FROM ledger_preferences WHERE ledger_id = 'personal'").run();
    await db.prepare("DELETE FROM ledgers WHERE id = 'personal'").run();
    await db.prepare("INSERT INTO ledgers (id, user_id) VALUES ('unexpected', 'owner')").run();
    await expect(provisionOwnerIdentityBindings(db, [ownerIdentity])).rejects.toThrow();
    expect(await db.prepare('SELECT COUNT(*) AS count FROM user_identities').first()).toEqual({ count: 0 });
  });

  it('prevents deleting or renaming a user that owns a ledger', async () => {
    const db = fixture();
    await expect(db.prepare("DELETE FROM users WHERE id = 'owner'").run()).rejects.toThrow();
    await expect(db.prepare("UPDATE users SET id = 'replacement' WHERE id = 'owner'").run()).rejects.toThrow();
  });

  it('prevents identity reassignment and removal', async () => {
    const db = fixture();
    await provisionOwnerIdentityBindings(db, [ownerIdentity]);
    await expect(db.prepare("UPDATE user_identities SET subject = 'replacement'").run()).rejects.toThrow();
    await expect(db.prepare('DELETE FROM user_identities').run()).rejects.toThrow();
  });
});
