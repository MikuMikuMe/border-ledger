import {describe,expect,it} from 'vitest';
import {signGatewayBody,verifyGatewayBody} from '../worker/ai-egress-auth';
const secret='ab'.repeat(32), timestamp='1800000000000', body='{"synthetic":true}';
describe('private gateway authentication',()=>{
  it('authenticates the exact body within a short time window',async()=>{
    const signature=await signGatewayBody(secret,timestamp,body);
    expect(await verifyGatewayBody(secret,{timestamp,body,signature},Number(timestamp))).toBe(true);
    expect(await verifyGatewayBody(secret,{timestamp,body:body+' ',signature},Number(timestamp))).toBe(false);
    expect(await verifyGatewayBody(secret,{timestamp,body,signature},Number(timestamp)+30001)).toBe(false);
    expect(await verifyGatewayBody('cd'.repeat(32),{timestamp,body,signature},Number(timestamp))).toBe(false);
  });
  it('fails closed for malformed keys or signatures',async()=>{
    await expect(signGatewayBody('invalid',timestamp,body)).rejects.toThrow();
    expect(await verifyGatewayBody(secret,{timestamp,body,signature:'invalid'},Number(timestamp))).toBe(false);
  });
});
