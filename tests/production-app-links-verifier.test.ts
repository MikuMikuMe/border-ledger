import { describe, expect, it, vi } from 'vitest';
import { verifyProductionAppLinks } from '../scripts/verify-production-app-links.mjs';

const currentSigner = '58:27:E8:17:EB:AD:9D:47:8C:A2:C3:C4:70:A3:74:2D:78:3F:C7:D2:BF:BF:FB:8C:C5:82:19:B5:F3:E6:84:17';
const legacySigner = '1F:F2:A2:5E:39:13:6E:EF:A7:9D:23:CC:75:31:F7:02:B2:A1:62:28:05:38:41:05:09:CA:2F:F6:5B:47:44:ED';
const deploymentRevision = 'a'.repeat(40);

function assetLinks(fingerprints: string[]) {
  return [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: 'com.lofuyu.borderledger',
      sha256_cert_fingerprints: fingerprints,
    },
  }];
}

function jsonResponse(body: unknown, status = 200) {
  return { status, json: async () => body };
}

describe('production App Links verification', () => {
  it('retries a stale response with a deployment cache key until both signers are visible', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(assetLinks([currentSigner])))
      .mockResolvedValueOnce(jsonResponse(assetLinks([currentSigner, legacySigner])));
    const waitImpl = vi.fn().mockResolvedValue(undefined);

    const result = await verifyProductionAppLinks({
      fetchImpl,
      deploymentRevision,
      attempts: 2,
      retryDelayMs: 0,
      waitImpl,
    });

    expect(result).toEqual({ attempts: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[0][0])).toContain(`deploymentRevision=${deploymentRevision}`);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      redirect: 'error',
      headers: { 'cache-control': 'no-cache' },
    });
    expect(waitImpl).toHaveBeenCalledTimes(1);
  });

  it('fails with signer diagnostics after the bounded retry window', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(assetLinks([currentSigner])));
    const waitImpl = vi.fn().mockResolvedValue(undefined);

    await expect(verifyProductionAppLinks({
      fetchImpl,
      deploymentRevision,
      attempts: 2,
      retryDelayMs: 0,
      waitImpl,
    })).rejects.toThrow('after 2 attempts (matching entries: 1, relation authorized: true, current signer present: true, legacy signer present: false)');

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(waitImpl).toHaveBeenCalledTimes(1);
  });
});
