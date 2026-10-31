import {readEnvelope} from './envelope.js';
import {sendPinned} from './pinned-request.js';

function providerHeaders(input) {
  const result = {'content-type':'application/json'};
  for (const name of ['authorization','x-api-key','anthropic-version']) {
    if (typeof input[name] === 'string' && input[name].length <= 8192) result[name] = input[name];
  }
  return result;
}
function gatewayResponse(result) {
  if (!Number.isInteger(result.status)) throw new Error('Invalid response');
  if (result.status < 200 || result.status > 599) throw new Error('Invalid response');
  const body = [204,205,304].includes(result.status) ? null : result.body;
  return new Response(body, {status:result.status});
}
export async function handleGatewayRequest(request, send = sendPinned) {
  let envelope;
  try { envelope = await readEnvelope(request); } catch { return new Response('Invalid request', {status:400}); }
  try { return gatewayResponse(await send(envelope.endpoint, providerHeaders(envelope.headers), envelope.body)); }
  catch { return new Response('Provider unavailable', {status:503}); }
}
