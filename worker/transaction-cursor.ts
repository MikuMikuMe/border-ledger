const MAX_CURSOR_LENGTH = 512;
const MAX_ID_LENGTH = 128;

export interface TransactionCursor {
  date: string;
  id: string;
}

function invalid(): never {
  throw new RangeError('The transaction cursor is not valid.');
}

function isTransactionCursor(value: unknown): value is TransactionCursor {
  if (typeof value !== 'object' || value === null) return false;
  const cursor = value as Partial<TransactionCursor>;
  return typeof cursor.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(cursor.date) &&
    typeof cursor.id === 'string' && cursor.id.length > 0 && cursor.id.length <= MAX_ID_LENGTH;
}

export function encodeCursor(value: TransactionCursor) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function decodeCursor(value: string | null): TransactionCursor | null {
  if (value === null) return null;
  const validLength = value.length > 0 && value.length <= MAX_CURSOR_LENGTH;
  const validEncoding = /^[A-Za-z0-9_-]+$/.test(value);
  if (!validLength || !validEncoding) invalid();
  let cursor: unknown;
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
    cursor = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0))));
  } catch {
    invalid();
  }
  if (!isTransactionCursor(cursor)) invalid();
  return cursor;
}
