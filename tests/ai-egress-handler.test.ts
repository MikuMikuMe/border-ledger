import {describe, expect, it, vi} from 'vitest';
import {handleGatewayRequest} from '../ai-egress/handler.js';

const request = (body:unknown) => new Request('http://container/provider', {method:'POST',body:JSON.stringify(body)});
describe('internal AI egress gateway', () => {
  it('only forwards the provider headers and returns the provider response', async () => {
    const send = vi.fn(async () => ({status:200,body:'{"choices":[]}'}));
    const response = await handleGatewayRequest(request({endpoint:'https://provider.example/v1',headers:{authorization:'Bearer key','x-untrusted':'discard'},body:'{}'}), send);
    expect(response.status).toBe(200);
    expect(send).toHaveBeenCalledWith('https://provider.example/v1', {authorization:'Bearer key','content-type':'application/json'}, '{}');
  });
  it('fails closed and does not reveal provider errors', async () => {
    const response = await handleGatewayRequest(request({endpoint:'https://provider.example',headers:{},body:'{}'}), async () => {throw new Error('secret financial details');});
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('secret');
  });
  it('rejects malformed and oversized requests before opening a connection', async () => {
    const send = vi.fn();
    expect((await handleGatewayRequest(request({endpoint:'https://provider.example',headers:{},body:'x'.repeat(300000)}),send)).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });
});
