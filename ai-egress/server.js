import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {handleGatewayRequest} from './handler.js';

export function createGatewayServer(handle = handleGatewayRequest) {
  const server = createServer(async (incoming, outgoing) => {
    if (incoming.method === 'GET' && incoming.url === '/ping') { outgoing.writeHead(200).end('ok'); return; }
    try {
      const request = new Request('http://container' + incoming.url, {
        method:incoming.method, headers:incoming.headers,
        body:Readable.toWeb(incoming), duplex:'half',
      });
      const response = await handle(request);
      outgoing.writeHead(response.status);
      if (response.body) Readable.fromWeb(response.body).pipe(outgoing);
      else outgoing.end();
    } catch { outgoing.writeHead(503).end('Provider unavailable'); }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  return server;
}
