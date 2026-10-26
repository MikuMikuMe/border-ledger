import type { LedgerContext } from './tenant-context';

export const NATIVE_PROTOCOL = '2';
export const PROTOCOL_HEADER = 'X-Ledger-Protocol';

/** Compatibility is not authority. Revocation must remain available during upgrade. */
export function nativeCompatibilityResponse(request: Request): Response | null {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/mobile/v1/') || /\/auth\/(revocations|logout)$/.test(path)) return null;
  if (request.headers.get(PROTOCOL_HEADER) === NATIVE_PROTOCOL) return null;
  return Response.json({ code: 'update_required', message: 'Update Border Ledger and sign in again.', requestId: crypto.randomUUID(), retryable: false }, { status: 426, headers: { 'Cache-Control': 'no-store' } });
}

export async function webIdentityHeaders(request: Request, context: LedgerContext): Promise<Headers> {
  // Called only after this exact request assertion has passed verified identity resolution.
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(request.headers.get('Cf-Access-Jwt-Assertion') ?? ''));
  const session = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  return new Headers({ 'X-Ledger-User': context.userId, 'X-Ledger-Id': context.ledgerId, 'X-Ledger-Session': session, 'Cache-Control': 'no-store' });
}

export function matchesExpectedWebSession(request: Request, identity: Headers): boolean {
  const expected = request.headers.get('X-Ledger-Expected-Session');
  return expected === null || expected === identity.get('X-Ledger-Session');
}

export function bindWebResponse(response: Response, identity: Headers): Response {
  const headers = new Headers(response.headers);
  identity.forEach((value, name) => headers.set(name, value));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
