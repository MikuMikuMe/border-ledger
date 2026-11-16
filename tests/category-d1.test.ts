import {describe,it,expect} from 'vitest';
import {createD1Fixture,currentMigrationNames} from './helpers/d1';
import {provisionWebOwner} from './helpers/web-identity';
import {createCategory,listCategories} from '../worker/category-store';

describe('categories on D1',()=>{
 it('loads an empty list and creates the reported category',async()=>{
  const fixture=await createD1Fixture(currentMigrationNames);
  try {
   await provisionWebOwner(fixture.db);
   const owner={userId:'owner',ledgerId:'personal'};
   expect(await listCategories(fixture.db,owner)).toEqual([]);
   await createCategory(fixture.db,owner,'Hobbies & Collectibles');
   expect(await listCategories(fixture.db,owner)).toEqual([{name:'Hobbies & Collectibles',archived:false}]);
  } finally {await fixture.dispose();}
 },30000);
});
