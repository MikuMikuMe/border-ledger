import { describe, expect, it } from 'vitest';
import {
  BodyTooLargeError,
  apiSecurityHeaders,
  isAllowedApplicationOrigin,
  isSameOriginMutation,
  readJsonBody,
} from '../worker/security';

describe('Worker security boundaries', () => {
  it('accepts only the configured application origin', () => {
    expect(isAllowedApplicationOrigin(new Request('https://pf.example.com/api/accounts'), 'https://pf.example.com')).toBe(true);
    expect(isAllowedApplicationOrigin(new Request('https://border-ledger.workers.dev/api/accounts'), 'https://pf.example.com')).toBe(false);
    expect(isAllowedApplicationOrigin(new Request('https://pf.example.com.evil.test/api/accounts'), 'https://pf.example.com')).toBe(false);
  });

  it('requires an explicit same-origin marker for state-changing requests', () => {
    const sameOrigin = new Request('https://pf.example.com/api/plaid/exchange', {
      method: 'POST',
      headers: { Origin: 'https://pf.example.com' },
    });
    const crossOrigin = new Request('https://pf.example.com/api/plaid/exchange', {
      method: 'POST',
      headers: { Origin: 'https://attacker.example' },
    });
    const missingOrigin = new Request('https://pf.example.com/api/plaid/exchange', { method: 'POST' });

    expect(isSameOriginMutation(sameOrigin, 'https://pf.example.com')).toBe(true);
    expect(isSameOriginMutation(crossOrigin, 'https://pf.example.com')).toBe(false);
    expect(isSameOriginMutation(missingOrigin, 'https://pf.example.com')).toBe(false);
  });

  it('rejects bodies above the configured limit before JSON parsing', async () => {
    const request = new Request('https://pf.example.com/api/imports/commit', {
      method: 'POST',
      body: JSON.stringify({ value: 'too large for this test' }),
    });

    await expect(readJsonBody(request, 8)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it('provides private API response headers', () => {
    expect(apiSecurityHeaders()).toMatchObject({
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    });
  });
});
