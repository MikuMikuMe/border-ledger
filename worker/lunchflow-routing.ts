export interface LunchFlowSelectionAccount {
  providerAccountId: string;
  currency: string;
  kind: 'chequing' | 'savings' | 'credit';
}

export interface LunchFlowQueueAccount {
  providerAccountId: string;
  revision: number;
}

type LunchFlowSelectionKind = LunchFlowSelectionAccount['kind'];
const LUNCHFLOW_SELECTION_KINDS = new Set<LunchFlowSelectionKind>(['chequing', 'savings', 'credit']);

function isObject(value: unknown): value is object {
  return value !== null && typeof value === 'object';
}

function recordValue(value: unknown): Record<string, unknown> | null {
  if (!isObject(value)) return null;
  if (Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, maxLength: number): value is string {
  if (typeof value !== 'string') return false;
  if (value.length < 1) return false;
  return value.length <= maxLength;
}

function selectionKind(value: unknown): value is LunchFlowSelectionKind {
  if (typeof value !== 'string') return false;
  return LUNCHFLOW_SELECTION_KINDS.has(value as LunchFlowSelectionKind);
}

function positiveRevision(value: unknown): number | null {
  if (typeof value !== 'number') return null;
  if (!Number.isSafeInteger(value)) return null;
  if (value < 1) return null;
  return value;
}

function basicSelectionAccount(value: unknown): value is LunchFlowSelectionAccount {
  const row = recordValue(value);
  if (!row) return false;
  return typeof row.providerAccountId === 'string'
    && typeof row.currency === 'string'
    && typeof row.kind === 'string';
}

function boundedSelectionAccount(value: unknown): value is LunchFlowSelectionAccount {
  if (!basicSelectionAccount(value)) return false;
  if (!boundedString(value.providerAccountId, 256)) return false;
  if (!boundedString(value.currency, 12)) return false;
  return selectionKind(value.kind);
}

export function parseLunchFlowSelectionAccounts(value: unknown): LunchFlowSelectionAccount[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every(basicSelectionAccount)) return null;
  return value;
}

export function parseLunchFlowMobileSelectionAccounts(value: unknown): LunchFlowSelectionAccount[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > 25) return null;
  if (!value.every(boundedSelectionAccount)) return null;
  return value;
}

function queueAccountValue(value: unknown): LunchFlowQueueAccount | null {
  const row = recordValue(value);
  if (!row) return null;
  if (!boundedString(row.providerAccountId, 256)) return null;
  const revision = positiveRevision(row.revision);
  if (revision === null) return null;
  return { providerAccountId: row.providerAccountId, revision };
}

export function parseLunchFlowQueueAccounts(value: unknown): LunchFlowQueueAccount[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > 25) return null;
  const seen = new Set<string>();
  const accounts: LunchFlowQueueAccount[] = [];
  for (const item of value) {
    const account = queueAccountValue(item);
    if (!account || seen.has(account.providerAccountId)) return null;
    seen.add(account.providerAccountId);
    accounts.push(account);
  }
  return accounts;
}
