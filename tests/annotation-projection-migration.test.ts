import {describe,expect,it} from 'vitest';
import {applyMigrations,createD1Fixture,currentMigrationNames} from './helpers/d1';
import {seedTenants} from './helpers/tenants';

describe('historical annotation projection',()=>{
  it('uses the latest ledger-scoped revision without changing unrelated records',async()=>{
    const fixture=await createD1Fixture(currentMigrationNames.slice(0,-1));
    try{
      await seedTenants(fixture.db);
      await fixture.db.prepare("INSERT INTO annotation_revisions(id,ledger_id,transaction_id,author_subject_hash,revision,category,note) VALUES('old','personal','owner-tx-1','hash',1,'Old','note'),('new','personal','owner-tx-1','hash',2,'Dining',NULL)").run();
      await applyMigrations(fixture.db,['0035-annotation-projection.sql']);
      expect(await fixture.db.prepare("SELECT category,note FROM transactions WHERE id='owner-tx-1'").first()).toEqual({category:'Dining',note:null});
      expect(await fixture.db.prepare("SELECT category,note FROM transactions WHERE id='owner-tx-2'").first()).toEqual({category:'Food',note:null});
      expect(await fixture.db.prepare("SELECT category,note FROM transactions WHERE id='second-tx-1'").first()).toEqual({category:'Food',note:null});
    }finally{await fixture.dispose();}
  },30000);
});