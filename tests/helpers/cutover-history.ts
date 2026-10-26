import type { D1Database } from '../../worker/db-types';

export async function seedOwnerHistory(db: D1Database) {
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


export async function seedAdditionalHistory(db: D1Database) {
  const sql = [
    "INSERT INTO accounts (id,name,institution,currency,kind,status) VALUES ('usd-account','USD synthetic','Bank','USD','savings','connected'),('statement-account','Statement synthetic','Bank','CAD','chequing','import_only')",
    "INSERT INTO transactions (id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint) VALUES ('manual-income','old-account','2026-10-20','Synthetic salary',5000,'CAD','Income','income','confirmed','manual','manual-fingerprint'),('statement-expense','statement-account','2026-10-20','Synthetic statement',-100,'CAD','Food','expense','confirmed','statement','statement-fingerprint'),('lf-pending','usd-account','2026-10-20','Synthetic pending',-2500,'USD','Food','expense','provisional','lunchflow','lf-fingerprint')",
    "UPDATE lunchflow_accounts SET account_id='usd-account',currency='USD' WHERE provider_account_id='old-lunch-account'",
    "INSERT INTO transaction_source_records (id,source_kind,identity_key,transaction_id,account_id,content_digest,file_sha256,row_index) VALUES ('statement-source','statement','statement-identity','statement-expense','statement-account','statement-digest','old-sha',0)",
    "INSERT INTO import_commit_operations(id,account_id,file_sha256,status,requested_count,accepted_count,duplicate_count,review_count) VALUES ('old-commit','old-account','old-sha','committed',1,1,0,0)",
    "INSERT INTO statement_reconciliation_candidates(id,source_record_id,statement_transaction_id,candidate_transaction_id,score,evidence_basis) VALUES ('old-candidate','statement-source','statement-expense','old-tx',70,'candidate_rank')",
    "INSERT INTO import_duplicate_decisions(preview_id,candidate_id,statement_transaction_id,candidate_transaction_id,status) VALUES ('old-preview','old-candidate','statement-expense','old-tx','dismissed')",
    "INSERT INTO mobile_devices(id,device_name,platform) VALUES ('old-device','Synthetic device','android')",
    "INSERT INTO device_pairings(id,device_id,device_verifier_hash,user_code_hash,expires_at) VALUES ('old-pairing','old-device','old-verifier','old-code','2099-01-01')",
    "INSERT INTO capture_credentials(id,device_id,credential_hash,credential_type,scope,generation,issued_at,expires_at) VALUES ('old-capture','old-device','old-capture-hash','capture','alerts:write',1,'2026-10-20','2099-01-01')",
    "INSERT INTO owner_replay_records(id,request_kind,request_digest,response_ciphertext,response_iv,expires_at) VALUES ('old-replay','refresh','old-replay-digest','synthetic-ciphertext','synthetic-iv','2099-01-01')",
    "INSERT INTO fx_rate_snapshots(requested_date,effective_date,provider,rates_json,content_digest,fetched_at) VALUES ('2026-10-20','2026-10-20','frankfurter','{\"USD\":0.75}','old-fx-digest','2026-10-20')",
    "UPDATE ledger_preferences SET preferred_currency='CAD',week_start=0,revision=3 WHERE ledger_id='personal'",
    "INSERT INTO sync_state(connection_id,provider) VALUES ('plaid:old-item','plaid')",
  ];
  await db.batch(sql.map(query => db.prepare(query)));
}

export type TableSnapshot = Record<string, { columns: string[]; rows: Record<string, unknown>[] }>;
export const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
export async function captureHistory(db: D1Database): Promise<TableSnapshot> {
  const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '__migrations' AND name NOT GLOB '_cf_*' ORDER BY name").all<{name:string}>();
  const result: TableSnapshot = {};
  for (const { name } of tables.results) {
    const columns = (await db.prepare(`PRAGMA table_info(${quoteIdentifier(name)})`).all<{name:string}>()).results.map(column => column.name);
    const rows = (await db.prepare(`SELECT ${columns.map(quoteIdentifier).join(',')} FROM ${quoteIdentifier(name)}`).all()).results;
    result[name] = { columns, rows: rows.sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) };
  }
  return result;
}
export async function syntheticExport(db: D1Database, snapshot: TableSnapshot) {
  const definitions = (await db.prepare("SELECT type,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name <> '__migrations' AND name NOT GLOB '_cf_*' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END,name").all<{type:string;sql:string}>()).results;
  const quote = (value: unknown) => value === null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
  const inserts = Object.entries(snapshot).flatMap(([table, data]) => data.rows.map(row => `INSERT INTO ${quoteIdentifier(table)} (${data.columns.map(quoteIdentifier).join(',')}) VALUES (${data.columns.map(column => quote(row[column])).join(',')})`));
  return ['PRAGMA defer_foreign_keys = ON', ...definitions.filter(row => row.type === 'table').map(row => row.sql), ...inserts, ...definitions.filter(row => row.type !== 'table').map(row => row.sql)];
}
