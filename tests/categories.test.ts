import {describe,it,expect} from 'vitest';
import {createSqliteD1Fixture} from './helpers/sqlite-d1';
import {createCategory,listCategories} from '../worker/category-store';

const owner={userId:'owner',ledgerId:'personal'};
describe('shared categories',()=>{
 it('persists names and rejects whitespace and case duplicates',async()=>{
  const f=createSqliteD1Fixture();try {
   expect(await listCategories(f.db,owner)).toEqual([]);
   await createCategory(f.db,owner,'  Groceries  ');
   expect(await listCategories(f.db,owner)).toEqual([{name:'Groceries',archived:false}]);
   await expect(createCategory(f.db,owner,'groceries')).rejects.toThrow();
   await expect(createCategory(f.db,owner,'   ')).rejects.toThrow();
  } finally {f.close();}
 });
 it('enforces ledger authority for reads and writes',async()=>{
  const f=createSqliteD1Fixture();try {
   const intruder={userId:'intruder',ledgerId:'personal'};
   await expect(listCategories(f.db,intruder)).rejects.toThrow();
   await expect(createCategory(f.db,intruder,'Food')).rejects.toThrow();
  } finally {f.close();}
 });
 it('reports a duplicate if another request creates the same name first',async()=>{
  const f=createSqliteD1Fixture();try {
   const batch=f.db.batch.bind(f.db);let inserted=false;
   f.db.batch=async statements=>{if(!inserted){inserted=true;await f.db.prepare("INSERT INTO categories(ledger_id,name,name_key) VALUES('personal','Food','food')").run();}return batch(statements);};
   await expect(createCategory(f.db,owner,'Food')).rejects.toThrow('Category already exists');
  }finally{f.close();}
 });
});
