import { describe, expect, it, vi } from 'vitest';

const nativeWealth = vi.hoisted(() => ({ createIdentifier: vi.fn(() => 'native-wealth-uuid') }));
vi.mock('../mobile/src/native/specs/NativeWealth', () => ({ default: nativeWealth }));

const { createSecureIdentifier } = await import('../mobile/src/features/wealth/identity');

describe('mobile Wealth identifier boundary', () => {
  it('uses the native UUID when Web Crypto is absent', () => {
    const originalCrypto = (globalThis as { crypto?: unknown }).crypto;
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
    try {
      expect(createSecureIdentifier('wealth')).toBe('wealth-native-wealth-uuid');
      expect(nativeWealth.createIdentifier).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto });
    }
  });
});
