import {lookup as dnsLookup} from 'node:dns/promises';
import {request as httpsRequest} from 'node:https';
import {resolvePublicAddress} from './address.js';

const limit = 262144;
function endpointUrl(endpoint) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:') throw new Error('Invalid endpoint');
  if ([url.port, url.username, url.password, url.search, url.hash].some(Boolean)) throw new Error('Invalid endpoint');
  return url;
}

function collectResponse(response, resolve, reject) {
  const chunks = [];
  let length = 0;
  response.on('data', chunk => {
    length += chunk.length;
    if (length > limit) { response.destroy(); reject(new Error('Provider response too large')); return; }
    chunks.push(chunk);
  });
  response.on('error', () => reject(new Error('Provider unavailable')));
  response.on('end', () => resolve({status:response.statusCode,body:Buffer.concat(chunks).toString('utf8')}));
}

export async function sendPinned(endpoint, headers, body, dependencies = {}) {
  const url = endpointUrl(endpoint);
  const signal = AbortSignal.timeout(30000);
  const timedOut = new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('Provider unavailable')), {once:true}));
  const selected = await Promise.race([resolvePublicAddress(url.hostname, dependencies.lookup ?? dnsLookup), timedOut]);
  const request = dependencies.request ?? httpsRequest;
  return new Promise((resolve, reject) => {
    const outgoing = request(url, {
      method:'POST', headers, agent:false, servername:url.hostname, rejectUnauthorized:true, signal,
      family:selected.family, autoSelectFamily:false,
      lookup:(_host, _options, callback) => callback(null, selected.address, selected.family),
    }, response => collectResponse(response, resolve, reject));
    outgoing.on('error', () => reject(new Error('Provider unavailable')));
    outgoing.setTimeout(30000, () => outgoing.destroy());
    outgoing.end(body);
  });
}
