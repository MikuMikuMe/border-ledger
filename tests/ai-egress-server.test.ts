import {afterEach, describe, expect, it, vi} from 'vitest';
import type {Server} from 'node:http';
import {createGatewayServer} from '../ai-egress/server.js';

let server:Server;
afterEach(async () => {if (server) await new Promise(resolve => server.close(resolve));});
describe('gateway HTTP runtime', () => {
  it('serves health checks and forwards internal requests to the handler', async () => {
    const handler = vi.fn(async request => new Response(await request.text(), {status:202}));
    server = createGatewayServer(handler);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
    expect((await fetch(base + '/ping')).status).toBe(200);
    const response = await fetch(base + '/provider', {method:'POST',body:'synthetic'});
    expect(response.status).toBe(202);
    expect(await response.text()).toBe('synthetic');
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
