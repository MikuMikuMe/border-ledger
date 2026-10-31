async function readBytes(stream) {
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 280000) throw new Error('Invalid request');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}
function requireText(value, limit) {
  if (typeof value !== 'string' || value.length > limit) throw new Error('Invalid request');
}
function validateEnvelope(value) {
  requireText(value.endpoint, 2048);
  requireText(value.body, 240000);
  if (!value.headers || typeof value.headers !== 'object') throw new Error('Invalid request');
  return value;
}
export async function readEnvelope(request) {
  if (request.method !== 'POST') throw new Error('Invalid request');
  if (new URL(request.url).pathname !== '/provider') throw new Error('Invalid request');
  if (!request.body) throw new Error('Invalid request');
  return validateEnvelope(JSON.parse((await readBytes(request.body)).toString('utf8')));
}
