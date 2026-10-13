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
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'geolocation=(), microphone=(), camera=()',
    'cross-origin-resource-policy': 'same-origin',
    'x-frame-options': 'DENY',
  };
}

export async function readRequestText(request: Request, maxBytes: number) {
  const contentLength = request.headers.get('content-length');
  if (contentLength && Number.isFinite(Number(contentLength)) && Number(contentLength) > maxBytes) {
    throw new BodyTooLargeError();
  }
  const body = await request.arrayBuffer();
  if (body.byteLength > maxBytes) throw new BodyTooLargeError();
  return new TextDecoder().decode(body);
}

export async function readJsonBody<T>(request: Request, maxBytes: number): Promise<T> {
  const text = await readRequestText(request, maxBytes);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new InvalidJsonBodyError();
  }
}
