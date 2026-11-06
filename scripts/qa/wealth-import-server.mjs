/** Loopback-only synthetic Wealth QA. Never deploy or use production data. */
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

const root = fileURLToPath(new URL('../../', import.meta.url));
const vite = await createViteServer({ root, server: { middlewareMode: true, watch: { ignored: ['**/android/**/build/**', '**/shared/**/build/**'] } }, appType: 'spa' });
const { createSqliteD1Fixture } = await vite.ssrLoadModule('/tests/helpers/sqlite-d1.ts');
const { handleWealthApi } = await vite.ssrLoadModule('/worker/wealth-http.ts');
const fixture = createSqliteD1Fixture();
const scope = { ledgerId: 'personal', userId: 'owner' };
const failures = { wealthStatus: 0, delayPreview: false };
const port = Number(process.env.WEALTH_QA_PORT ?? 18094);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid QA port.');

async function bodyOf(incoming) {
  const chunks = []; let size = 0;
  for await (const chunk of incoming) {
    size += chunk.length;
    if (size > 6 * 2 * 1024 * 1024 + 256 * 1024) throw new Error('QA request too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function datedReportRequest(request, url) {
  if (url.pathname !== '/api/wealth/report' || url.searchParams.has('asOf')) return request;
  for (const [key, value] of Object.entries({ asOf: '2026-11-03', from: '2026-11-01', to: '2026-11-03' })) url.searchParams.set(key, value);
  return new Request(url, request);
}

function isPreviewWrite(request, url) {
  return request.method === 'POST' && url.pathname === '/api/wealth/imports/preview';
}

async function wealthResponse(request, url) {
  if (failures.wealthStatus) return Response.json({ error: 'Synthetic QA service failure.' }, { status: failures.wealthStatus });
  if (failures.delayPreview && isPreviewWrite(request, url)) await new Promise(resolve => setTimeout(resolve, 16000));
  return await handleWealthApi(datedReportRequest(request, url), fixture.db, scope, { root: '/api/wealth', env: {} }) ?? Response.json({ error: 'Unknown QA route.' }, { status: 404 });
}

async function responseFor(request) {
  const url = new URL(request.url);
  if (url.pathname === '/__qa/failures' && request.method === 'POST') {
    const body = await request.json();
    failures.wealthStatus = body.wealthStatus === 503 ? 503 : 0;
    failures.delayPreview = body.delayPreview === true;
    return Response.json(failures);
  }
  if (url.pathname.startsWith('/api/wealth')) return wealthResponse(request, url);
  if (url.pathname === '/api/accounts') return Response.json({ accounts: [] });
  if (url.pathname === '/api/transactions') return Response.json({ transactions: [] });
  return Response.json({ error: 'Unknown QA route.' }, { status: 404 });
}

function isApiRequest(path = '') {
  return path.startsWith('/api/') || path.startsWith('/__qa/');
}

async function nodeRequest(incoming, started) {
  const body = await bodyOf(incoming);
  console.log(incoming.method, incoming.url, 'bytes', body.length, 'receivedMs', Date.now() - started);
  const method = incoming.method ?? 'GET';
  const payload = ['GET', 'HEAD'].includes(method) ? {} : { body };
  return new Request(`http://127.0.0.1:${port}${incoming.url}`, { method, headers: incoming.headers, ...payload });
}

const server = createServer(async (incoming, outgoing) => {
  if (!isApiRequest(incoming.url)) return vite.middlewares(incoming, outgoing);
  outgoing.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:8794');
  outgoing.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  outgoing.setHeader('Cache-Control', 'no-store');
  if (incoming.method === 'OPTIONS') { outgoing.writeHead(204); outgoing.end(); return; }
  const started = Date.now();
  try {
    const response = await responseFor(await nodeRequest(incoming, started));
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
    console.log('response', response.status, 'elapsedMs', Date.now() - started);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'QA request failed.');
    if (!outgoing.headersSent) outgoing.writeHead(500, { 'Content-Type': 'application/json' });
    outgoing.end(JSON.stringify({ error: 'QA request failed.' }));
  }
});
server.requestTimeout = 20000;
server.listen(port, '127.0.0.1', () => console.log(`Synthetic Wealth QA: http://127.0.0.1:${port}`));
async function close() { server.close(); fixture.close(); await vite.close(); process.exit(0); }
process.on('SIGINT', close);
process.on('SIGTERM', close);
