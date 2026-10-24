import { describe, expect, it } from 'vitest';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { OWNER_LEDGER, SECOND_LEDGER, seedTenants, tenantOwner } from './helpers/tenants';
import { readLedgerReport } from '../worker/ledger-reports';
import { readOwnerLedgerSnapshot } from '../worker/owner-ledger-snapshot';
import { readMobileTransactionPage } from '../worker/mobile-transactions';
import { readPreferences, updatePreferences } from '../worker/preferences-store';
import { createLedgerExportResponse } from '../worker/mobile-export';

async function seedSnapshotProjections(db: import('../worker/db-types').D1Database) {
  for (const context of [OWNER_LEDGER, SECOND_LEDGER]) {
    const user = context.userId;
    await db.prepare("UPDATE transactions SET status='needs_review' WHERE id=? AND ledger_id=?").bind(`${user}-tx-1`,context.ledgerId).run();
    await db.prepare("INSERT INTO plaid_items(item_id,ledger_id,access_token_ciphertext,access_token_iv) VALUES (?,?,'cipher','iv')").bind(`${user}-item`,context.ledgerId).run();
    await db.prepare(`INSERT INTO recurring_streams(id,ledger_id,item_id,stream_id,account_id,currency,source_status,source_frequency,frequency,is_outflow)
      VALUES (?,?,?,?,?,'CAD','active','monthly','monthly',1)`).bind(`${user}-stream`,context.ledgerId,`${user}-item`,'same-provider-stream',`${user}-account`).run();
    await db.prepare("INSERT INTO recurring_classifications(recurring_stream_id,ledger_id,classification) VALUES (?,?,'bill')").bind(`${user}-stream`,context.ledgerId).run();
  }
}

describe('core ledger isolation', () => {
  it('aggregates only the requested ledger, beyond page limits', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await seedTenants(fixture.db);
      const report = await readLedgerReport(fixture.db, SECOND_LEDGER);
      expect(report.ledgerId).toBe('second-ledger');
      expect(report.currencyTotals).toEqual([{currency:'CAD',confirmedMinorUnits:1800,provisionalMinorUnits:0,confirmedCount:2,provisionalCount:0}]);
    } finally { fixture.close(); }
  });
  it('reads only owned snapshot accounts and financial projections', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await seedTenants(fixture.db);
      await seedSnapshotProjections(fixture.db);
      const snapshot = await readOwnerLedgerSnapshot(fixture.db, SECOND_LEDGER);
      expect(snapshot.recurring.map(row => row.id)).toEqual(['second-stream']);
      expect(snapshot.recurring[0].classification).toBe('bill');
      expect(snapshot.reviews.map(row => row.id)).toEqual(['second-tx-1']);
      expect(snapshot.timeZone).toBe('UTC');
      expect(snapshot.accounts.map(row => row.id)).toEqual(['second-account']);
      expect(snapshot.transactions.map(row => row.id).sort()).toEqual(['second-tx-1','second-tx-2']);
    } finally { fixture.close(); }
  });
  it('isolates preferences and optimistic revisions', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await seedTenants(fixture.db);
      expect((await readPreferences(fixture.db, SECOND_LEDGER)).reportingTimezone).toBe('UTC');
      await updatePreferences(fixture.db, SECOND_LEDGER, 0, {reportingTimezone:'Asia/Shanghai',weekStart:1,preferredCurrency:'CAD'});
      expect((await readPreferences(fixture.db, OWNER_LEDGER)).revision).toBe(0);
      expect((await readPreferences(fixture.db, SECOND_LEDGER)).revision).toBe(1);
    } finally { fixture.close(); }
  });
  it('keeps export counts and streamed rows within the authenticated ledger', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await seedTenants(fixture.db);
      const response = await createLedgerExportResponse(fixture.db, tenantOwner(SECOND_LEDGER), {}, {selection:'current_filter',filters:{currency:'CAD'}});
      expect(response.headers.get('x-worker-exported-rows')).toBe('2');
      const csv = await response.text();
      expect(csv).toContain('second-tx-1');
      expect(csv).not.toContain('owner-tx');
    } finally { fixture.close(); }
  });
  it('rejects an export using a context whose user was disabled', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await seedTenants(fixture.db);
      await fixture.db.prepare("UPDATE users SET status='disabled' WHERE id='owner'").run();
      await expect(createLedgerExportResponse(fixture.db, tenantOwner(OWNER_LEDGER), {}, {selection:'current_filter',filters:{currency:'CAD'}})).rejects.toThrow();
    } finally { fixture.close(); }
  });
  it('rejects an export using a revoked native family', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await seedTenants(fixture.db);
      await fixture.db.prepare("UPDATE owner_session_families SET revoked_at='2026-10-24T00:00:00Z' WHERE id='second-family'").run();
      await expect(createLedgerExportResponse(fixture.db, tenantOwner(SECOND_LEDGER), {}, {selection:'current_filter',filters:{currency:'CAD'}})).rejects.toMatchObject({status:403});
    } finally {fixture.close();}
  });
  it('paginates within tenant ownership even when another tenant supplies a cursor', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await seedTenants(fixture.db);
      const first = await readMobileTransactionPage(fixture.db, SECOND_LEDGER, new URLSearchParams('limit=1'));
      expect(first.items.map(row => row.id)).toEqual(['second-tx-2']);
      const next = await readMobileTransactionPage(fixture.db, SECOND_LEDGER, new URLSearchParams({limit:'1',cursor:first.page.nextCursor!}));
      expect(next.items.map(row => row.id)).toEqual(['second-tx-1']);
      expect(next.page.nextCursor).toBeNull();
      const foreign = await readMobileTransactionPage(fixture.db, OWNER_LEDGER, new URLSearchParams('limit=1'));
      const guessed = await readMobileTransactionPage(fixture.db, SECOND_LEDGER, new URLSearchParams({cursor:foreign.page.nextCursor!}));
      expect(guessed.items.every(row => row.accountId === 'second-account')).toBe(true);
    } finally { fixture.close(); }
  });
});
