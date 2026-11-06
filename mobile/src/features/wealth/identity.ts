import NativeWealth from '../../native/specs/NativeWealth';

type RuntimeCrypto = {
  crypto?: {
    randomUUID?: () => string;
    getRandomValues?: (bytes: Uint8Array) => Uint8Array;
  };
};
type NativeIdentifierModule = { createIdentifier?: () => string };

function uuidFromRandomBytes(bytes: Uint8Array): string {
  const value = Uint8Array.from(bytes);
  value[6] = (value[6] & 0x0f) | 0x40;
  value[8] = (value[8] & 0x3f) | 0x80;
  const hex = Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function nativeIdentifier(): string | null {
  const createIdentifier = (NativeWealth as NativeIdentifierModule).createIdentifier;
  return createIdentifier ? createIdentifier() : null;
}

function runtimeIdentifier(runtimeCrypto: RuntimeCrypto['crypto']): string | null {
  if (!runtimeCrypto) return null;
  if (runtimeCrypto.randomUUID) return runtimeCrypto.randomUUID();
  if (!runtimeCrypto.getRandomValues) return null;
  return uuidFromRandomBytes(runtimeCrypto.getRandomValues(new Uint8Array(16)));
}

/**
 * Creates an opaque identifier for an idempotent draft or bridge operation.
 * Android uses the synchronous NativeWealth UUID boundary. Web Crypto remains
 * available for test and portable hosts; failing closed avoids weak entropy.
 */
export function createSecureIdentifier(prefix?: string): string {
  const uuid = nativeIdentifier() ?? runtimeIdentifier((globalThis as RuntimeCrypto).crypto);
  if (!uuid) throw new Error('Secure identifier generation is unavailable.');
  return prefix ? `${prefix}-${uuid}` : uuid;
}
