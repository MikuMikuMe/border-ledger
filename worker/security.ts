export class BodyTooLargeError extends Error {
  constructor() {
    super('Request body is too large.');
    this.name = 'BodyTooLargeError';
  }
}

export class InvalidJsonBodyError extends Error {
  constructor() {
    super('Request body must be valid JSON.');
    this.name = 'InvalidJsonBodyError';
  }
}

function normalizedOrigin(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function configuredOrigins(value: string | undefined) {
  return new Set((value ?? '').split(',').map((item) => normalizedOrigin(item)).filter((item): item is string => Boolean(item)));
}

export function isAllowedApplicationOrigin(request: Request, configuredOrigin: string | undefined) {
  const requestOrigin = normalizedOrigin(new URL(request.url).origin);
  return Boolean(requestOrigin && configuredOrigins(configuredOrigin).has(requestOrigin));
}

export function isSameOriginMutation(request: Request, configuredOrigin: string | undefined) {
  if (!isAllowedApplicationOrigin(request, configuredOrigin)) return false;
  const requestOrigin = normalizedOrigin(new URL(request.url).origin);
  const originHeader = normalizedOrigin(request.headers.get('origin'));
  return Boolean(requestOrigin && originHeader && requestOrigin === originHeader && configuredOrigins(configuredOrigin).has(originHeader));
}

export function apiSecurityHeaders() {
  return {
    'cache-control': 'no-store',
    'strict-transport-security': 'max-age=31536000',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'geolocation=(), microphone=(), camera=()',
    'cross-origin-resource-policy': 'same-origin',
    'x-frame-options': 'DENY',
  };
}

export function staticSecurityHeaders() {
  return {
    'content-security-policy': "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' https://cdn.plaid.com; connect-src 'self' https://*.plaid.com; frame-src https://*.plaid.com; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'",
    'strict-transport-security': 'max-age=31536000',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'geolocation=(), microphone=(), camera=()',
    'cross-origin-resource-policy': 'same-origin',
    'x-frame-options': 'DENY',
  };
}

function hasOversizedDeclaredLength(contentLength: string | null, maxBytes: number) {
  if (!contentLength) return false;
  const declaredLength = Number(contentLength);
  if (!Number.isFinite(declaredLength)) return false;
  return declaredLength > maxBytes;
}

async function readBoundedRequestText(reader: ReadableStreamDefaultReader<Uint8Array>, maxBytes: number) {
  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    if (byteLength + value.byteLength > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError();
    }
    byteLength += value.byteLength;
    text += decoder.decode(value, { stream: true });
  }
}

export async function readRequestText(request: Request, maxBytes: number) {
  const body = request.body;
  if (hasOversizedDeclaredLength(request.headers.get('content-length'), maxBytes)) {
    await body?.cancel().catch(() => undefined);
    throw new BodyTooLargeError();
  }

  const reader = body?.getReader();
  if (!reader) return '';
  try {
    return await readBoundedRequestText(reader, maxBytes);
  } finally {
    reader.releaseLock();
  }
}

export async function readJsonBody<T>(request: Request, maxBytes: number): Promise<T> {
  const text = await readRequestText(request, maxBytes);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new InvalidJsonBodyError();
  }
}
