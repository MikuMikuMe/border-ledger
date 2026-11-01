import {createServer} from 'node:net';
import {describe,it,expect} from 'vitest';
import {findSafeLoopbackPort} from './helpers/loopback-port';
describe('safe test transport port selection',()=>{
 it('skips an occupied loopback port and returns a free safe port',async()=>{
  const occupied=await findSafeLoopbackPort(),server=createServer();
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(occupied,'127.0.0.1',resolve);});
  let attempt=0;
  try {
   const fallback=await findSafeLoopbackPort();
   const selected=await findSafeLoopbackPort({candidate:()=>attempt++===0?occupied:fallback});
   expect(selected).not.toBe(occupied);expect(attempt).toBe(2);
  }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
 });
 it('retries permission-denied ports within a bounded attempt count',async()=>{
  let attempts=0;
  const denied=Object.assign(new Error('Denied'),{code:'EACCES'});
  await expect(findSafeLoopbackPort({candidate:()=>20001,probe:async()=>{attempts++;throw denied;}})).rejects.toBe(denied);
  expect(attempts).toBe(20);
 });
 it('propagates unexpected errors without retrying and rejects unsafe candidates',async()=>{
  let attempts=0;const failure=Object.assign(new Error('Unexpected'),{code:'EIO'});
  await expect(findSafeLoopbackPort({probe:async()=>{attempts++;throw failure;}})).rejects.toBe(failure);
  expect(attempts).toBe(1);
  await expect(findSafeLoopbackPort({candidate:()=>6000})).rejects.toThrow('safe range');
 });
});
