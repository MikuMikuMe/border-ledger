import {describe,it,expect} from 'vitest';
import {createSqliteD1Fixture} from './helpers/sqlite-d1';
import {seedTenants,OWNER_LEDGER} from './helpers/tenants';
import {configureBudget,setBudgetAllocation} from '../worker/budget-store';
import {previewCategoryCleanup,archiveCategory,applyCategoryCleanup,restoreCategory} from '../worker/category-management';
import {createCategory,listCategories} from '../worker/category-store';
import {handleBudgetApi} from '../worker/budget-http';
import {annotateMobileTransaction} from '../worker/mobile-review';
import {createManualTransaction} from '../worker/manual-transactions';
describe('category management',()=>{
 it('previews affected records and overlapping budget allocations without changing them',async()=>{
  const f=createSqliteD1Fixture();try {
   await seedTenants(f.db);await configureBudget(f.db,OWNER_LEDGER,'CAD','2026-01');
   await setBudgetAllocation(f.db,OWNER_LEDGER,{month:'2026-10',category:'Food',assignedMinor:100});
   await setBudgetAllocation(f.db,OWNER_LEDGER,{month:'2026-10',category:'Dining',assignedMinor:200});
   const preview=await previewCategoryCleanup(f.db,OWNER_LEDGER,'Food','Dining');
   expect(preview.transactions).toBe(2);expect(preview.budget.allocations).toBe(1);expect(preview.conflicts).toContain('allocations');
   expect(await f.db.prepare("SELECT category FROM transactions WHERE id='owner-tx-1'").first()).toEqual({category:'Food'});
  }finally{f.close();}
 });
 it('saves the full legacy category when annotating a transaction',async()=>{
  const f=createSqliteD1Fixture();try {
   await seedTenants(f.db);const category='A'.repeat(100);
   const saved=await createManualTransaction(f.db,OWNER_LEDGER,{requestId:'category_length_test',accountId:'owner-account',date:'2026-10-24',merchant:'Shop',amount:'1.00',currency:'CAD',category:'Food',kind:'expense',note:null});
   await annotateMobileTransaction(f.db,OWNER_LEDGER,saved.id,{expectedRevision:0,category,note:'Note'});
   expect(await f.db.prepare("SELECT category,note FROM transactions WHERE id=?").bind(saved.id).first()).toEqual({category,note:'Note'});
   await expect(annotateMobileTransaction(f.db,OWNER_LEDGER,saved.id,{expectedRevision:1,category:'A'.repeat(121),note:null})).rejects.toThrow();
  }finally{f.close();}
 });
 it('archives an existing legacy category without hiding its history',async()=>{
  const f=createSqliteD1Fixture();try {
   await seedTenants(f.db);await archiveCategory(f.db,OWNER_LEDGER,'Food');
   expect(await listCategories(f.db,OWNER_LEDGER)).toContainEqual({name:'Food',archived:true});
   expect((await f.db.prepare("SELECT COUNT(*) AS count FROM transactions WHERE ledger_id='personal' AND category='Food'").first<{count:number}>())?.count).toBe(2);
  }finally{f.close();}
 });
 it('previews the latest annotation even when the transaction projection is stale',async()=>{
  const f=createSqliteD1Fixture();try {
   await seedTenants(f.db);
   await f.db.prepare("INSERT INTO annotation_revisions(id,ledger_id,transaction_id,author_subject_hash,revision,category,note) VALUES('annotation','personal','owner-tx-1','hash',1,'Travel','note')").run();
   const preview=await previewCategoryCleanup(f.db,OWNER_LEDGER,'Travel','Dining');
   expect(preview.transactions).toBe(1);
  }finally{f.close();}
 });
 it('applies a confirmed cleanup without changing another ledger or annotation history',async()=>{
  const f=createSqliteD1Fixture();try {
   await seedTenants(f.db);await configureBudget(f.db,OWNER_LEDGER,'CAD','2026-01');
   await setBudgetAllocation(f.db,OWNER_LEDGER,{month:'2026-10',category:'Food',assignedMinor:100});
   const preview=await previewCategoryCleanup(f.db,OWNER_LEDGER,'Food','Dining');
   await applyCategoryCleanup(f.db,OWNER_LEDGER,{from:'Food',to:'Dining',version:preview.version});
   expect(await f.db.prepare("SELECT category FROM transactions WHERE id='owner-tx-1'").first()).toEqual({category:'Dining'});
   expect(await f.db.prepare("SELECT category FROM transactions WHERE id='second-tx-1'").first()).toEqual({category:'Food'});
   expect(await f.db.prepare("SELECT category,revision FROM annotation_revisions WHERE transaction_id='owner-tx-1'").first()).toEqual({category:'Dining',revision:1});
   expect(await f.db.prepare("SELECT category,assigned_minor FROM budget_allocations WHERE ledger_id='personal'").first()).toEqual({category:'Dining',assigned_minor:100});
  }finally{f.close();}
 });
 it('rejects a stale preview and budget collisions atomically',async()=>{
  const f=createSqliteD1Fixture();try {
   await seedTenants(f.db);await configureBudget(f.db,OWNER_LEDGER,'CAD','2026-01');
   const preview=await previewCategoryCleanup(f.db,OWNER_LEDGER,'Food','Dining');
   await setBudgetAllocation(f.db,OWNER_LEDGER,{month:'2026-10',category:'Food',assignedMinor:100});
   await expect(applyCategoryCleanup(f.db,OWNER_LEDGER,{from:'Food',to:'Dining',version:preview.version})).rejects.toThrow();
   await setBudgetAllocation(f.db,OWNER_LEDGER,{month:'2026-10',category:'Dining',assignedMinor:200});
   const conflict=await previewCategoryCleanup(f.db,OWNER_LEDGER,'Food','Dining');
   await expect(applyCategoryCleanup(f.db,OWNER_LEDGER,{from:'Food',to:'Dining',version:conflict.version})).rejects.toThrow();
   expect(await f.db.prepare("SELECT category FROM transactions WHERE id='owner-tx-1'").first()).toEqual({category:'Food'});
  }finally{f.close();}
 });
 it('preserves the latest note and archives the old legacy category after cleanup',async()=>{
  const f=createSqliteD1Fixture();try {
   await seedTenants(f.db);
   await f.db.prepare("INSERT INTO annotation_revisions(id,ledger_id,transaction_id,author_subject_hash,revision,category,note) VALUES('old-note','personal','owner-tx-1','hash',1,'Food','updated note')").run();
   const preview=await previewCategoryCleanup(f.db,OWNER_LEDGER,'Food','Dining');
   await applyCategoryCleanup(f.db,OWNER_LEDGER,{from:'Food',to:'Dining',version:preview.version});
   expect(await f.db.prepare("SELECT category,note FROM transactions WHERE id='owner-tx-1'").first()).toEqual({category:'Dining',note:'updated note'});
   expect(await listCategories(f.db,OWNER_LEDGER)).toContainEqual({name:'Food',archived:true});
  }finally{f.close();}
 });
 it('rolls back if activity changes between preview and publication',async()=>{
  const f=createSqliteD1Fixture();try {
   await seedTenants(f.db);
   const preview=await previewCategoryCleanup(f.db,OWNER_LEDGER,'Food','Dining');
   const batch=f.db.batch.bind(f.db);let changed=false;
   f.db.batch=async statements=>{if(!changed){changed=true;await f.db.prepare("UPDATE transactions SET note='concurrent edit' WHERE id='owner-tx-1'").run();}return batch(statements);};
   await expect(applyCategoryCleanup(f.db,OWNER_LEDGER,{from:'Food',to:'Dining',version:preview.version})).rejects.toThrow();
   expect(await f.db.prepare("SELECT category,note FROM transactions WHERE id='owner-tx-1'").first()).toEqual({category:'Food',note:'concurrent edit'});
   expect(await f.db.prepare("SELECT COUNT(*) AS count FROM annotation_revisions WHERE ledger_id='personal'").first()).toEqual({count:0});
  }finally{f.close();}
 });
 it('maps future imported transactions to a merged category and rejects stale annotations',async()=>{
  const f=createSqliteD1Fixture();try {
   await seedTenants(f.db);
   const preview=await previewCategoryCleanup(f.db,OWNER_LEDGER,'Food','Dining');
   await applyCategoryCleanup(f.db,OWNER_LEDGER,{from:'Food',to:'Dining',version:preview.version});
   await f.db.prepare("INSERT INTO transactions(id,ledger_id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint) VALUES('imported','personal','owner-account','2026-10-24','Store',-1,'CAD','Food','expense','confirmed','statement','imported-fp')").run();
   expect(await f.db.prepare("SELECT category FROM transactions WHERE id='imported'").first()).toEqual({category:'Dining'});
   await expect(f.db.prepare("INSERT INTO annotation_revisions(id,ledger_id,transaction_id,author_subject_hash,revision,category,note) VALUES('stale','personal','imported','hash',1,'Food',NULL)").run()).rejects.toThrow();
   expect(await f.db.prepare("SELECT category FROM transactions WHERE id='second-tx-1'").first()).toEqual({category:'Food'});
  }finally{f.close();}
 });
 it('keeps redirects correct across repeated renames, including a return to an earlier name',async()=>{
  const f=createSqliteD1Fixture();try {
   await seedTenants(f.db);
   for(const [from,to] of [['Food','Dining'],['Dining','Restaurants'],['Restaurants','Food']]) {
    const preview=await previewCategoryCleanup(f.db,OWNER_LEDGER,from,to);
    await applyCategoryCleanup(f.db,OWNER_LEDGER,{from,to,version:preview.version});
   }
   await f.db.prepare("INSERT INTO transactions(id,ledger_id,account_id,date,merchant,amount_minor,currency,category,kind,status,source,fingerprint) VALUES('new-dining','personal','owner-account','2026-10-24','Store',-1,'CAD','Dining','expense','confirmed','statement','dining-fp')").run();
   expect(await f.db.prepare("SELECT category FROM transactions WHERE id='new-dining'").first()).toEqual({category:'Food'});
   expect(await f.db.prepare("SELECT category FROM transactions WHERE id='owner-tx-1'").first()).toEqual({category:'Food'});
  }finally{f.close();}
 });
 it('redirects old budget category names and refuses collisions without losing amounts',async()=>{
  const f=createSqliteD1Fixture();try {
   await seedTenants(f.db);await configureBudget(f.db,OWNER_LEDGER,'CAD','2026-01');
   const preview=await previewCategoryCleanup(f.db,OWNER_LEDGER,'Food','Dining');
   await applyCategoryCleanup(f.db,OWNER_LEDGER,{from:'Food',to:'Dining',version:preview.version});
   await setBudgetAllocation(f.db,OWNER_LEDGER,{month:'2026-10',category:'Food',assignedMinor:100});
   expect(await f.db.prepare("SELECT category,assigned_minor FROM budget_allocations WHERE ledger_id='personal'").first()).toEqual({category:'Dining',assigned_minor:100});
   await expect(setBudgetAllocation(f.db,OWNER_LEDGER,{month:'2026-10',category:'Food',assignedMinor:200})).rejects.toThrow();
   expect(await f.db.prepare("SELECT assigned_minor FROM budget_allocations WHERE ledger_id='personal'").first()).toEqual({assigned_minor:100});
  }finally{f.close();}
 });
 it('rejects invalid rename targets before preview',async()=>{
  const f=createSqliteD1Fixture();try {
   await seedTenants(f.db);
   await expect(previewCategoryCleanup(f.db,OWNER_LEDGER,'Food','Travel\nOther')).rejects.toThrow();
   await expect(previewCategoryCleanup(f.db,OWNER_LEDGER,'Food','x'.repeat(81))).rejects.toThrow();
  }finally{f.close();}
 });
 it('reports stale budget category collisions as a conflict',async()=>{
  const f=createSqliteD1Fixture();try {
   await seedTenants(f.db);await configureBudget(f.db,OWNER_LEDGER,'CAD','2026-01');
   const preview=await previewCategoryCleanup(f.db,OWNER_LEDGER,'Food','Dining');
   await applyCategoryCleanup(f.db,OWNER_LEDGER,{from:'Food',to:'Dining',version:preview.version});
   await setBudgetAllocation(f.db,OWNER_LEDGER,{month:'2026-10',category:'Dining',assignedMinor:100});
   const request=new Request('https://example.test/api/budget/allocations',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({month:'2026-10',category:'Food',assignedMinor:200})});
   expect((await handleBudgetApi(request,f.db,OWNER_LEDGER,'/api/budget'))?.status).toBe(409);
  }finally{f.close();}
 });
 it('rejects confirmation when a category is archived after the preview',async()=>{
  const f=createSqliteD1Fixture();try{
   await seedTenants(f.db);await createCategory(f.db,OWNER_LEDGER,'Dining');
   const preview=await previewCategoryCleanup(f.db,OWNER_LEDGER,'Food','Dining');
   await archiveCategory(f.db,OWNER_LEDGER,'Dining');
   await expect(applyCategoryCleanup(f.db,OWNER_LEDGER,{from:'Food',to:'Dining',version:preview.version})).rejects.toThrow();
   expect(await listCategories(f.db,OWNER_LEDGER)).toContainEqual({name:'Dining',archived:true});
  }finally{f.close();}
 });
 it('reports a normalized-name collision when archiving legacy categories',async()=>{
  const f=createSqliteD1Fixture();try {
   await seedTenants(f.db);
   await f.db.prepare("INSERT INTO categories(ledger_id,name,name_key,archived) VALUES('personal','FOOD','food',0)").run();
   await expect(archiveCategory(f.db,OWNER_LEDGER,'Food')).rejects.toThrow('Category already exists');
  }finally{f.close();}
 });
 it('cleans up an imported category with surrounding spaces',async()=>{
  const f=createSqliteD1Fixture();try {
   await seedTenants(f.db);
   await f.db.prepare("UPDATE transactions SET category=' Food ' WHERE id='owner-tx-1'").run();
   const preview=await previewCategoryCleanup(f.db,OWNER_LEDGER,' Food ','Food');
   await applyCategoryCleanup(f.db,OWNER_LEDGER,{from:' Food ',to:'Food',version:preview.version});
   expect(await f.db.prepare("SELECT category FROM transactions WHERE id='owner-tx-1'").first()).toEqual({category:'Food'});
  }finally{f.close();}
 });
 it('restores archived categories but not merged aliases',async()=>{
  const f=createSqliteD1Fixture();try{
   await seedTenants(f.db);await archiveCategory(f.db,OWNER_LEDGER,'Food');
   await restoreCategory(f.db,OWNER_LEDGER,'Food');
   expect(await listCategories(f.db,OWNER_LEDGER)).toContainEqual({name:'Food',archived:false});
   const preview=await previewCategoryCleanup(f.db,OWNER_LEDGER,'Food','Dining');
   await applyCategoryCleanup(f.db,OWNER_LEDGER,{from:'Food',to:'Dining',version:preview.version});
   await expect(restoreCategory(f.db,OWNER_LEDGER,'Food')).rejects.toThrow();
  }finally{f.close();}
 });
});
