import {beforeEach,describe,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({dispose:vi.fn(async()=>{}),getDatabase:vi.fn(),readyFailures:0,readyError:undefined as unknown,ports:[] as number[]}));
vi.mock('miniflare',()=>({
 convertV4MiniflareOptions:(options:unknown)=>options,
 Miniflare:class {
  private readonly port:number;
  constructor(options:{host:string;port:number}){this.port=options.port;state.ports.push(options.port);}
  get ready(){if(state.readyFailures>0){state.readyFailures--;return Promise.reject(state.readyError);}return Promise.resolve(new URL(`http://127.0.0.1:${this.port}`));}
  getD1Database(){return state.getDatabase();}
  dispose(){return state.dispose();}
 },
}));
import {createD1Fixture} from './helpers/d1';
beforeEach(()=>{vi.clearAllMocks();state.readyFailures=0;state.readyError=undefined;state.ports.length=0;});
describe('D1 fixture startup lifecycle',()=>{
 it('disposes the worker when D1 binding initialization fails',async()=>{
  const failure=new Error('Binding startup failed');state.getDatabase.mockRejectedValueOnce(failure);
  await expect(createD1Fixture([])).rejects.toBe(failure);expect(state.dispose).toHaveBeenCalledTimes(1);
 });
 it('disposes the worker when a migration fails',async()=>{
  const failure=new Error('Migration failed');state.getDatabase.mockResolvedValueOnce({prepare:()=>({run:async()=>{throw failure;}})});
  await expect(createD1Fixture([])).rejects.toBe(failure);expect(state.dispose).toHaveBeenCalledTimes(1);
 });
 it('retries a bind race and disposes each failed runtime before returning a working fixture',async()=>{
  state.readyFailures=1;state.readyError=Object.assign(new Error('Port raced'),{code:'ERR_ADDRESS_IN_USE'});
  state.getDatabase.mockResolvedValueOnce({prepare:()=>({run:async()=>({})})});
  const fixture=await createD1Fixture([]);
  expect(state.dispose).toHaveBeenCalledTimes(1);expect(state.ports).toHaveLength(2);
  expect(state.ports.every(port=>port>=20000&&port<=40000)).toBe(true);
  await fixture.dispose();expect(state.dispose).toHaveBeenCalledTimes(2);
 });
 it('bounds startup permission retries and preserves the startup error',async()=>{
  state.readyFailures=5;state.readyError=Object.assign(new Error('Port denied'),{code:'EACCES'});
  await expect(createD1Fixture([])).rejects.toBe(state.readyError);
  expect(state.dispose).toHaveBeenCalledTimes(5);expect(state.getDatabase).not.toHaveBeenCalled();
 });
});
