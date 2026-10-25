import { describe, expect, it } from 'vitest';
import { applyMigrations, createD1Fixture, task20MigrationNames } from './helpers/d1';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import type { D1Database } from '../worker/db-types';
import { provisionOwnerIdentityBindings, resolveLedgerContext } from '../worker/tenant-context';

const migration = '0021-hosted-users.sql';
const existingMigrations = [...task20MigrationNames.slice(0, 11), '0011-native-connections.sql', ...task20MigrationNames.slice(11)];

async function seedOwnerHistory(db: D1Database) {
  const sql = [
    "INSERT INTO accounts (id,name,institution,currency,kind,status) VALUES ('old-account','Owner','Bank','CAD','chequing','connected')",
    "INSERT INTO plaid_items (item_id,access_token_ciphertext,access_token_iv) VALUES ('old-item','fixture-ciphertext','fixture-iv')",
    "INSERT INTO plaid_accounts (plaid_account_id,item_id,account_id,name) VALUES ('old-provider-account','old-item','old-account','Owner')",
    "INSERT INTO transactions (id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,plaid_item_id,provider_transaction_id) VALUES ('old-tx','old-account','2026-10-20','Owner purchase',-1234,'CAD','Food','expense','confirmed','plaid','old-fingerprint','old-item','old-external-tx')",
    "INSERT INTO imports (id,account_id,filename,row_count,accepted_count,error_count,status) VALUES ('old-import','old-account','owner.csv',1,1,0,'complete')",
    "INSERT INTO transaction_source_records (id,source_kind,identity_key,transaction_id,account_id,provider_item_id,provider_transaction_id,content_digest) VALUES ('old-source','plaid','old-identity','old-tx','old-account','old-item','old-external-tx','old-digest')",
    "INSERT INTO recurring_streams (id,item_id,stream_id,account_id,currency,source_status,source_frequency,frequency,is_outflow) VALUES ('old-stream','old-item','old-external-stream','old-account','CAD','active','MONTHLY','monthly',1)",
    "INSERT INTO recurring_stream_transactions (recurring_stream_id,item_id,provider_transaction_id,transaction_id,account_id,date,amount_minor,currency,kind,is_outflow) VALUES ('old-stream','old-item','old-external-tx','old-tx','old-account','2026-10-20',-1234,'CAD','expense',1)",
    "INSERT INTO lunchflow_accounts (provider_account_id,account_id,name,institution,currency,kind) VALUES ('old-lunch-account',NULL,'Owner savings','Bank','CAD','savings')",
    "INSERT INTO import_previews (id,account_id,filename,file_sha256,preview_digest,row_count,expires_at) VALUES ('old-preview','old-account','owner.csv','old-sha','old-preview-digest',1,'2099-01-01')",
    "INSERT INTO import_chunks (preview_id,chunk_index,operation_id,chunk_digest,row_start,row_count,rows_json) VALUES ('old-preview',0,'old-operation','old-chunk',0,1,'[]')",
    "INSERT INTO source_profiles (id,provider,source_kind,display_name,parser_version,status) VALUES ('old-profile','synthetic','alert','Owner source','test','approved')",
    "INSERT INTO alert_events (id,event_id,observation_id,source_profile_id,parser_version,captured_at,event_time_basis,event_type,direction,account_id,payload_digest) VALUES ('old-event','old-event','old-observation','old-profile','test','2026-10-20','bank_transaction_date','purchase_notice','outflow','old-account','old-payload')",
    "INSERT INTO alert_projections (id,event_id,transaction_id,state) VALUES ('old-projection','old-event','old-tx','provisional')",
    "INSERT INTO alert_projection_provenance (id,projection_id,source_kind,source_id,basis,revision) VALUES ('old-provenance','old-projection','alert','old-event','alert_event',1)",
    "INSERT INTO annotation_revisions (id,transaction_id,author_subject_hash,revision,category,note) VALUES ('old-annotation','old-tx','old-owner',1,'Food','Owner annotation')",
    "INSERT INTO alert_event_links (id,from_event_id,to_transaction_id,relation,evidence_basis,revision) VALUES ('old-link','old-event','old-tx','confirms','bank_reference',1)",
    "INSERT INTO owner_session_families (id,subject_hash,access_expires_at,refresh_expires_at) VALUES ('old-session','old-owner','2099-01-01','2099-01-01')",
    "INSERT INTO owner_refresh_generations (family_id,generation,token_hash,issued_at,expires_at) VALUES ('old-session',1,'old-token-hash','2026-10-20','2099-01-01')",

  ];
  await db.batch(sql.map(query => db.prepare(query)));
}

async function snapshot(db: D1Database) {
  const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '__migrations' AND name NOT GLOB '_cf_*' AND name NOT IN ('ledgers','users','user_identities') ORDER BY name").all<{name: string}>();
  const result: Record<string, { columns: string[]; rows: unknown[] }> = {};
  for (const { name } of tables.results) {
    const columns = (await db.prepare(`PRAGMA table_info(${name})`).all<{name: string}>()).results.map(column => column.name);
    result[name] = { columns, rows: (await db.prepare(`SELECT ${columns.join(',')} FROM ${name} ORDER BY 1`).all()).results };
  }
  return result;
}

async function checkOwnership(db: D1Database, options:{currentSchema?:boolean}={}) {
  await db.prepare("INSERT INTO users (id) VALUES ('second')").run();
  await db.prepare("INSERT INTO ledgers (id,user_id) VALUES ('second-ledger','second')").run();
  await db.prepare("INSERT INTO accounts (id,ledger_id,name,institution,currency,kind,status) VALUES ('second-account','second-ledger','Second','Bank','CAD','savings','connected')").run();
  await expect(db.prepare("INSERT INTO transactions (id,ledger_id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint) VALUES ('bad','second-ledger','old-account','2026-10-20','Bad',1,'CAD','Food','expense','confirmed','manual','bad')").run()).rejects.toThrow();
  await expect(db.prepare("UPDATE accounts SET ledger_id='second-ledger' WHERE id='old-account'").run()).rejects.toThrow();
  await expect(db.prepare("DELETE FROM ledgers WHERE id='second-ledger'").run()).rejects.toThrow();
  await expect(db.prepare("INSERT INTO import_previews (id,ledger_id,account_id,filename,file_sha256,preview_digest,row_count,expires_at) VALUES ('bad-preview','second-ledger','old-account','x.csv','x','x',0,'2099-01-01')").run()).rejects.toThrow();
  if(options.currentSchema){
    await db.prepare("INSERT INTO lunchflow_connections(id,user_id,ledger_id,adapter,app_client_id) VALUES ('second-platform','second','second-ledger','platform','test-client')").run();
    await db.prepare("INSERT INTO lunchflow_accounts(provider_account_id,ledger_id,connection_id,name,institution) VALUES ('old-lunch-account','second-ledger','second-platform','Second','Bank')").run();
  }else{
  await db.prepare("INSERT INTO lunchflow_accounts (provider_account_id,ledger_id,name,institution) VALUES ('old-lunch-account','second-ledger','Second','Bank')").run();
  }
  await expect(db.prepare("INSERT INTO ledgers (id,user_id) VALUES ('third-ledger','second')").run()).rejects.toThrow();
  await expect(db.prepare("INSERT INTO ledgers (id,user_id) VALUES ('orphan','absent')").run()).rejects.toThrow();
}

describe('hosted users migration', () => {
  it('preserves every owner record, amount, identifier and relationship through the migration chain', async () => {
    const fixture = await createD1Fixture(existingMigrations);
    try {
      await seedOwnerHistory(fixture.db);
      const before = await snapshot(fixture.db);
      expect(before.transactions.rows).toHaveLength(1);
      expect(before.imports.rows).toHaveLength(1);
      expect(before.recurring_stream_transactions.rows).toHaveLength(1);
      await applyMigrations(fixture.db, [migration]);
      for (const [table, { columns, rows }] of Object.entries(before)) {
        expect((await fixture.db.prepare(`SELECT ${columns.join(',')} FROM ${table} ORDER BY 1`).all()).results, table).toEqual(rows);
      }
      expect(await fixture.db.prepare('SELECT COUNT(*) AS count, SUM(amount_minor) AS total FROM transactions').first()).toEqual({count: 1, total: -1234});
      expect(await fixture.db.prepare("SELECT id,user_id FROM ledgers WHERE id='personal'").first()).toEqual({id: 'personal', user_id: 'owner'});
      expect(await fixture.db.prepare('SELECT COUNT(*) AS count FROM user_identities').first()).toEqual({count: 0});
      await checkOwnership(fixture.db);
      expect((await fixture.db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    } finally { await fixture.dispose(); }
  });

  it('enforces the same ownership boundary on fresh-schema databases', async () => {
    const fixture = createSqliteD1Fixture();
    try { await seedOwnerHistory(fixture.db); await checkOwnership(fixture.db,{currentSchema:true}); }
    finally { fixture.close(); }
  });

  it('provisions verified identities atomically using D1 batches', async () => {
    const fixture = await createD1Fixture([...existingMigrations, migration]);
    try {
      const identity = { issuer: 'https://access.example.test', subject: 'owner-subject' };
      await provisionOwnerIdentityBindings(fixture.db, [identity]);
      await provisionOwnerIdentityBindings(fixture.db, [identity]);
      expect(await resolveLedgerContext(fixture.db, identity)).toEqual({ userId: 'owner', ledgerId: 'personal' });
      await fixture.db.prepare("INSERT INTO users (id) VALUES ('second')").run();
      await fixture.db.prepare("INSERT INTO user_identities (issuer, subject, user_id) VALUES ('https://access.example.test','collision','second')").run();
      await expect(provisionOwnerIdentityBindings(fixture.db, [
        { ...identity, subject: 'fresh' }, { ...identity, subject: 'collision' },
      ])).rejects.toThrow();
      expect(await fixture.db.prepare("SELECT COUNT(*) AS count FROM user_identities WHERE subject='fresh'").first()).toEqual({ count: 0 });
    } finally { await fixture.dispose(); }
  });

  it('keeps fresh schema and migrated table columns aligned', async () => {
    const fixture = await createD1Fixture([...existingMigrations, migration]);
    const fresh = createSqliteD1Fixture();
    try {
      await applyMigrations(fixture.db, [
        '0022-unbound-auth.sql',
        '0023-plaid-tenant-connections.sql',
        '0024-alert-raw-identities.sql',
        '0025-lunchflow-platform.sql', '0026-lunchflow-connection-mappings.sql',
      ]);
      const tables = (await fresh.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all<{name:string}>()).results;
      for (const {name} of tables) {
        const columns = (db: D1Database) => db.prepare(`PRAGMA table_info(${name})`).all();
        const [a,b] = await Promise.all([columns(fixture.db), columns(fresh.db)]);
        const byName = (rows: Array<Record<string, unknown>>) => rows.map(({cid, ...column}) => column).sort((left, right) => String(left.name).localeCompare(String(right.name)));
        expect(byName(a.results), name).toEqual(byName(b.results));
      }
    } finally { fresh.close(); await fixture.dispose(); }
  });
});

const replaceCases = [
  ['sync update replacement', "UPDATE OR REPLACE sync_state SET connection_id='old-sync' WHERE connection_id='second-sync'"],
  ['transaction alternate provider update', "UPDATE OR REPLACE transactions SET plaid_item_id='old-item', provider_transaction_id='old-external-tx' WHERE id='second-tx'"],
  ['ledger alternate owner key with null id', "INSERT OR REPLACE INTO ledgers (id,user_id) VALUES (NULL,'owner')"],
  ['ledger primary key', "INSERT OR REPLACE INTO ledgers (id,user_id) VALUES ('personal','second')"],
  ['ledger alternate owner key', "INSERT OR REPLACE INTO ledgers (id,user_id) VALUES ('replacement-ledger','owner')"],
  ['populated account primary key', "INSERT OR REPLACE INTO accounts (id,ledger_id,name,institution,currency,kind,status) VALUES ('old-account','second-ledger','Replaced','Bank','CAD','savings','connected')"],
  ['transaction alternate provider key', "INSERT OR REPLACE INTO transactions (id,ledger_id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,plaid_item_id,provider_transaction_id) VALUES ('replacement-tx','second-ledger','second-account','2026-10-20','Replaced',-1,'CAD','Food','expense','confirmed','plaid','replacement-fingerprint','old-item','old-external-tx')"],
] as const;

async function createReplaceFixture(kind: string) {
  if (kind !== 'fresh SQLite') return createD1Fixture([...existingMigrations, migration]);
  const fresh = createSqliteD1Fixture();
  return { db: fresh.db, async dispose() { fresh.close(); } };
}

async function seedReplaceCase(db: D1Database, name: string) {
  if (name.startsWith('ledger alternate owner key')) {
    await db.prepare("DELETE FROM ledger_preferences WHERE ledger_id='personal'").run();
    await db.prepare("INSERT INTO accounts (id,name,institution,currency,kind,status) VALUES ('old-account','Owner','Bank','CAD','savings','connected')").run();
  } else if (name.startsWith('transaction alternate provider')) {
    await db.batch([
      db.prepare("INSERT INTO accounts (id,name,institution,currency,kind,status) VALUES ('old-account','Owner','Bank','CAD','savings','connected')"),
      db.prepare("INSERT INTO plaid_items (item_id,access_token_ciphertext,access_token_iv) VALUES ('old-item','fixture-ciphertext','fixture-iv')"),
      db.prepare("INSERT INTO transactions (id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,plaid_item_id,provider_transaction_id) VALUES ('old-tx','old-account','2026-10-20','Owner purchase',-1234,'CAD','Food','expense','confirmed','plaid','old-fingerprint','old-item','old-external-tx')"),
    ]);
  } else {
    await seedOwnerHistory(db);
  }
  await db.prepare("INSERT INTO users (id) VALUES ('second')").run();
  await db.prepare("INSERT INTO ledgers (id,user_id) VALUES ('second-ledger','second')").run();
  await db.prepare("INSERT INTO accounts (id,ledger_id,name,institution,currency,kind,status) VALUES ('second-account','second-ledger','Second','Bank','CAD','savings','connected')").run();
  if (name === 'sync update replacement') {
    await db.batch([
      db.prepare("INSERT INTO sync_state (connection_id,provider,ledger_id) VALUES ('old-sync','plaid','personal')"),
      db.prepare("INSERT INTO sync_state (connection_id,provider,ledger_id) VALUES ('second-sync','plaid','second-ledger')"),
    ]);
  }
  if (name === 'transaction alternate provider update') {
    await db.prepare("INSERT INTO transactions (id,ledger_id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint) VALUES ('second-tx','second-ledger','second-account','2026-10-21','Second purchase',-2,'CAD','Food','expense','confirmed','manual','second-fingerprint')").run();
  }
}
describe.each(['fresh SQLite', 'migrated D1'] as const)('REPLACE ownership collision protection: %s', (kind) => {
  it.each(replaceCases)('rejects %s without changing ledger ownership or financial children', async (name, sql) => {
    const fixture = await createReplaceFixture(kind);
    const { db } = fixture;
    try {
      await db.prepare('PRAGMA recursive_triggers = OFF').run();
      await seedReplaceCase(db, name);
      const before = await snapshot(db);
      const ledgers = (await db.prepare('SELECT id,user_id FROM ledgers ORDER BY id').all()).results;
      await expect(db.prepare(sql).run()).rejects.toThrow('ownership collision');
      expect(await snapshot(db)).toEqual(before);
      expect((await db.prepare('SELECT id,user_id FROM ledgers ORDER BY id').all()).results).toEqual(ledgers);
      expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    } finally { await fixture.dispose(); }
  });

  it('allows existing same-ledger upserts and replacements', async () => {
    const fixture = await createReplaceFixture(kind);
    const { db } = fixture;
    try {
      await db.prepare("INSERT INTO accounts (id,name,institution,currency,kind,status) VALUES ('same-account','Original','Bank','CAD','savings','connected')").run();
      await db.prepare("INSERT INTO accounts (id,name,institution,currency,kind,status) VALUES ('same-account','Updated','Bank','CAD','savings','connected') ON CONFLICT(id) DO UPDATE SET name=excluded.name").run();
      expect(await db.prepare("SELECT ledger_id,name FROM accounts WHERE id='same-account'").first()).toEqual({ ledger_id: 'personal', name: 'Updated' });
      await db.prepare("INSERT OR REPLACE INTO accounts (id,name,institution,currency,kind,status) VALUES ('same-account','Replaced','Bank','CAD','savings','connected')").run();
      expect(await db.prepare("SELECT ledger_id,name FROM accounts WHERE id='same-account'").first()).toEqual({ ledger_id: 'personal', name: 'Replaced' });
    } finally { await fixture.dispose(); }
  });
});
