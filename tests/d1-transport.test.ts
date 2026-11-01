import {describe,it,expect} from 'vitest';
import {createD1Fixture} from './helpers/d1';
describe('D1 fixture loopback transport',()=>{
 it('binds a Fetch-safe loopback port and performs real D1 reads and writes',async()=>{
  const fixture=await createD1Fixture([]);
  try {
   expect(fixture.url.hostname).toBe('127.0.0.1');
   expect(Number(fixture.url.port)).toBeGreaterThanOrEqual(20000);
   expect(Number(fixture.url.port)).toBeLessThanOrEqual(40000);
   await fixture.db.prepare('CREATE TABLE transport_probe(value TEXT NOT NULL)').run();
   await fixture.db.prepare('INSERT INTO transport_probe(value)VALUES(?)').bind('connected').run();
   expect(await fixture.db.prepare('SELECT value FROM transport_probe').first()).toEqual({value:'connected'});
  }finally{await fixture.dispose();}
 });
});
