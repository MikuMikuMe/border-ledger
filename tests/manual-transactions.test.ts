import { describe, expect, it } from 'vitest';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import { createManualTransaction, listManualMatches, decideManualMatch } from '../worker/manual-transactions';
import { readBudgetActivity } from '../worker/budget-activity';
import { readMobileTransactionPage } from '../worker/mobile-transactions';

const owner = { userId: 'owner', ledgerId: 'personal' };
const entry = { requestId: '6a34f000-4dc5-4fb8-a535-7bc60ce77ed6', accountId: 'acct', date: '2026-11-07', merchant: 'Coffee', amount: '12.34', currency: 'CAD', category: 'Food', kind: 'expense', note: null };

describe('manual transaction creation', () => {
  it('stores one confirmed transaction and provenance across retries', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await fixture.db.prepare("INSERT INTO accounts(id,name,institution,currency,kind,status,ledger_id) VALUES('acct','Account','Bank','CAD','chequing','connected','personal')").run();
      const first = await createManualTransaction(fixture.db, owner, entry);
      expect(await createManualTransaction(fixture.db, owner, entry)).toEqual(first);
      const rows = await fixture.db.prepare('SELECT amount_minor,source,status FROM transactions WHERE id=?').bind(first.id).all();
      expect(rows.results).toEqual([expect.objectContaining({ amount_minor: -1234, source: 'manual', status: 'confirmed' })]);
      expect((await fixture.db.prepare('SELECT id FROM transaction_source_records WHERE transaction_id=?').bind(first.id).all()).results).toHaveLength(1);
      expect((await readMobileTransactionPage(fixture.db, owner, new URLSearchParams())).items).toEqual([expect.objectContaining({id:first.id,merchant:'Coffee',source:'manual'})]);
      await expect(createManualTransaction(fixture.db, owner, {...entry, amount: '1.00'})).rejects.toThrow();
    } finally { fixture.close(); }
  });
  it.each([['expense',-1234],['income',1234],['transfer',-1234],['refund',1234],['fee',-1234]])('stores %s with the ledger sign convention', async (kind, amountMinor) => {
    const fixture=createSqliteD1Fixture();
    try {
      await fixture.db.prepare("INSERT INTO accounts(id,name,institution,currency,kind,status,ledger_id) VALUES('acct','Account','Bank','CAD','chequing','connected','personal')").run();
      const saved=await createManualTransaction(fixture.db, owner, {...entry,kind});
      expect(await fixture.db.prepare('SELECT amount_minor FROM transactions WHERE id=?').bind(saved.id).first()).toEqual({amount_minor:amountMinor});
    } finally { fixture.close(); }
  });
  it('records incoming transfers with a positive amount', async () => {
    const fixture=createSqliteD1Fixture();
    try {
      await fixture.db.prepare("INSERT INTO accounts(id,name,institution,currency,kind,status,ledger_id) VALUES('acct','Account','Bank','CAD','chequing','connected','personal')").run();
      const saved=await createManualTransaction(fixture.db, owner, {...entry,kind:'transfer',direction:'in'});
      expect(await fixture.db.prepare('SELECT amount_minor FROM transactions WHERE id=?').bind(saved.id).first()).toEqual({amount_minor:1234});
    } finally { fixture.close(); }
  });
  it('rejects invalid dates, precision, and foreign accounts', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await expect(createManualTransaction(fixture.db, owner, {...entry, date: '2026-02-30'})).rejects.toThrow();
      await expect(createManualTransaction(fixture.db, owner, {...entry, amount: '1.001'})).rejects.toThrow();
      await expect(createManualTransaction(fixture.db, owner, entry)).rejects.toThrow();
    } finally { fixture.close(); }
  });
  it('prevents another ledger from creating or reviewing entries in this ledger', async () => {
    const fixture=createSqliteD1Fixture();
    try {
      await fixture.db.prepare("INSERT INTO accounts(id,name,institution,currency,kind,status,ledger_id) VALUES('acct','Account','Bank','CAD','chequing','connected','personal')").run();
      await fixture.db.prepare("INSERT INTO users(id) VALUES('other')").run();
      await fixture.db.prepare("INSERT INTO ledgers(id,user_id) VALUES('other-ledger','other')").run();
      const other={userId:'other',ledgerId:'other-ledger'};
      await expect(createManualTransaction(fixture.db,other,entry)).rejects.toThrow();
      await createManualTransaction(fixture.db,owner,entry);
      expect(await listManualMatches(fixture.db,other)).toEqual([]);
      await expect(decideManualMatch(fixture.db,other,{manualId:'manual-id',bankId:'bank-id',decision:'confirmed',expectedRevision:0})).rejects.toThrow();
    } finally {fixture.close();}
  });
  it('requires explicit review, suppresses confirmed matches and restores them', async () => {
    const fixture = createSqliteD1Fixture();
    try {
      await fixture.db.prepare("INSERT INTO accounts(id,name,institution,currency,kind,status,ledger_id) VALUES('acct','Account','Bank','CAD','chequing','connected','personal')").run();
      const manual = await createManualTransaction(fixture.db, owner, entry);
      await fixture.db.prepare("INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,ledger_id) VALUES('bank','acct','2026-11-08','Coffee',-1234,'CAD','Food','expense','confirmed','plaid','bank','personal')").run();
      const matches = await listManualMatches(fixture.db, owner);
      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({manualId: manual.id, bankId:'bank', decision:'open', revision:0});
      const read = () => readBudgetActivity(fixture.db, owner, {from:'2026-11-01',to:'2026-11-30',currency:'CAD'});
      expect(await read()).toHaveLength(2);
      await decideManualMatch(fixture.db, owner, {manualId:manual.id,bankId:'bank',decision:'confirmed',expectedRevision:0});
      expect(await decideManualMatch(fixture.db, owner, {manualId:manual.id,bankId:'bank',decision:'confirmed',expectedRevision:0})).toMatchObject({revision:1});
      expect((await read()).map(row=>row.id)).toEqual(['bank']);
      await expect(decideManualMatch(fixture.db, owner, {manualId:manual.id,bankId:'bank',decision:'dismissed',expectedRevision:0})).rejects.toThrow();
      await decideManualMatch(fixture.db, owner, {manualId:manual.id,bankId:'bank',decision:'dismissed',expectedRevision:1});
      expect(await read()).toHaveLength(2);
    } finally { fixture.close(); }
  });
  it('restores a manual entry when its confirmed bank match changes', async () => {
    const fixture=createSqliteD1Fixture();
    try {
      await fixture.db.prepare("INSERT INTO accounts(id,name,institution,currency,kind,status,ledger_id) VALUES('acct','Account','Bank','CAD','chequing','connected','personal')").run();
      const manual=await createManualTransaction(fixture.db,owner,entry);
      await fixture.db.prepare("INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,ledger_id) VALUES('bank','acct','2026-11-08','Coffee',-1234,'CAD','Food','expense','confirmed','plaid','bank','personal')").run();
      await decideManualMatch(fixture.db,owner,{manualId:manual.id,bankId:'bank',decision:'confirmed',expectedRevision:0});
      await fixture.db.prepare("UPDATE transactions SET amount_minor=-999 WHERE id='bank'").run();
      const rows=await readBudgetActivity(fixture.db,owner,{from:'2026-11-01',to:'2026-11-30',currency:'CAD'});
      expect(rows).toHaveLength(2);
      expect(await listManualMatches(fixture.db,owner)).toMatchObject([{decision:'stale'}]);
      await decideManualMatch(fixture.db,owner,{manualId:manual.id,bankId:'bank',decision:'dismissed',expectedRevision:1});
    } finally {fixture.close();}
  });
  it('does not allow two manual entries to suppress the same bank transaction', async () => {
    const fixture=createSqliteD1Fixture();
    try {
      await fixture.db.prepare("INSERT INTO accounts(id,name,institution,currency,kind,status,ledger_id) VALUES('acct','Account','Bank','CAD','chequing','connected','personal')").run();
      const first=await createManualTransaction(fixture.db,owner,entry);
      const second=await createManualTransaction(fixture.db,owner,{...entry,requestId:'second_manual_123456'});
      await fixture.db.prepare("INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,ledger_id) VALUES('bank','acct','2026-11-08','Coffee',-1234,'CAD','Food','expense','confirmed','plaid','bank','personal')").run();
      await decideManualMatch(fixture.db,owner,{manualId:first.id,bankId:'bank',decision:'confirmed',expectedRevision:0});
      await expect(decideManualMatch(fixture.db,owner,{manualId:second.id,bankId:'bank',decision:'confirmed',expectedRevision:0})).rejects.toThrow();
      expect(await readBudgetActivity(fixture.db,owner,{from:'2026-11-01',to:'2026-11-30',currency:'CAD'})).toHaveLength(2);
    } finally {fixture.close();}
  });
  it('returns later pages when there are more than 200 possible matches', async () => {
    const fixture=createSqliteD1Fixture();
    try {
      await fixture.db.prepare("INSERT INTO accounts(id,name,institution,currency,kind,status,ledger_id) VALUES('acct','Account','Bank','CAD','chequing','connected','personal')").run();
      for(let i=0;i<15;i++) await createManualTransaction(fixture.db,owner,{...entry,requestId:`pagination_manual_${String(i).padStart(4,'0')}`});
      for(let i=0;i<14;i++) await fixture.db.prepare("INSERT INTO transactions(id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint,ledger_id) VALUES(?,'acct','2026-11-08','Coffee',-1234,'CAD','Food','expense','confirmed','plaid',?,'personal')").bind(`bank-${i}`,`bank-${i}`).run();
      expect(await listManualMatches(fixture.db,owner)).toHaveLength(200);
      expect(await listManualMatches(fixture.db,owner,200)).toHaveLength(10);
    } finally {fixture.close();}
  });
});
