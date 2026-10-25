import type { LedgerContext } from './tenant-context';
import { assertFinancialAuthority, type FinancialContext } from './financial-authority';
import { getCurrencyMeta } from '../src/domain/currencies';
import type { D1Database } from './db-types';
import {
  createLunchFlowProvider,
  LUNCHFLOW_MAX_ACCOUNTS,
  LunchFlowError,
  mapLunchFlowTransaction,
  type LunchFlowAccount,
  type LunchFlowApiEnv,
  type LunchFlowTransaction,
} from './lunchflow';
import {
  lunchFlowLedgerAccountId,
  lunchFlowRequestDigest,
  publishLunchFlowSelection,
  publishLunchFlowSnapshot,
  readLunchFlowMapping,
  readLunchFlowMappings,
  readLunchFlowOperationRecord,
  recordLunchFlowError,
  rememberLunchFlowOperation,
  type LunchFlowMapping,
  type LunchFlowRevision,
} from './lunchflow-store';

export interface LunchFlowProvider {
  listAccounts(): Promise<LunchFlowAccount[]>;
  listTransactions(providerAccountId: string): Promise<LunchFlowTransaction[]>;
}

export interface LunchFlowServiceEnv extends LunchFlowApiEnv {
  DB: D1Database;
  SYNC_QUEUE?: { send(message: unknown): Promise<void> };
  now?: () => Date;
}

export interface LunchFlowSelectionInput {
  accounts: Array<{
    providerAccountId: string;
    currency: string;
    kind: 'chequing' | 'savings' | 'credit';
  }>;
  ownerSubjectHash?: string;
  idempotencyKey?: string;
}

export interface LunchFlowRevisionMessage extends LunchFlowRevision {
  providerAccountId: string;
}

export interface LunchFlowAccountsResponse {
  configured: boolean;
  archivedAccountCount?: number;
  accounts: Array<{
    providerAccountId: string;
    name: string;
    institution: string;
    currencies: string[];
    selected: boolean;
    accountId: string | null;
    kind: 'chequing' | 'savings' | 'credit' | null;
    currency: string | null;
    lastSyncedAt: string | null;
    lastError: string | null;
    lastAttemptAt?: string | null;
  }>;
}

export class LunchFlowServiceError extends LunchFlowError {}

const DISCOVERY_CONCURRENCY = 4;
const MAX_LUNCHFLOW_ACCOUNTS = LUNCHFLOW_MAX_ACCOUNTS;
const MAX_ACCOUNT_RESPONSE = 100;

function now(env: LunchFlowServiceEnv) {
  return (env.now?.() ?? new Date()).toISOString();
}

function configured(env: LunchFlowServiceEnv, context: LedgerContext) {
  return context.userId === 'owner' && context.ledgerId === 'personal' && Boolean(env.LUNCHFLOW_API_KEY?.trim());
}

function safeProviderError(error: unknown) {
  if (error instanceof LunchFlowError) return error;
  return new LunchFlowServiceError('provider_unavailable', 'Lunch Flow is temporarily unavailable.', 503, true);
}

function selectionError(code: string, message: string, status = 400): LunchFlowServiceError {
  return new LunchFlowServiceError(code, message, status, false);
}

function normalizedCurrency(value: string) {
  const code = value.trim().toUpperCase();
  if (!getCurrencyMeta(code)) throw selectionError('invalid_currency', 'The selected currency is not supported.');
  return code;
}

function normalizedProviderId(value: string) {
  const id = value.trim();
  if (!id || id.length > 256) throw selectionError('invalid_account', 'The selected Lunch Flow account is not valid.');
  return id;
}

function normalizedKind(value: string): 'chequing' | 'savings' | 'credit' {
  if (value !== 'chequing' && value !== 'savings' && value !== 'credit') throw selectionError('invalid_account_kind', 'The selected account kind is not valid.');
  return value;
}

function assertProviderAccountCount(accounts: readonly LunchFlowAccount[]) {
  if (accounts.length > MAX_LUNCHFLOW_ACCOUNTS) {
    throw selectionError('too_many_accounts', 'Lunch Flow returned more than 25 accounts. Narrow the Lunch Flow Personal API scope before syncing.', 422);
  }
}

function accountCurrencies(account: LunchFlowAccount) {
  return account.currency ? [account.currency] : [];
}

async function currenciesFor(provider: LunchFlowProvider, account: LunchFlowAccount) {
  const currencies = accountCurrencies(account);
  if (currencies.length > 0) return currencies;
  const transactions = await provider.listTransactions(account.id);
  return [...new Set(transactions.map((transaction) => transaction.currency.trim().toUpperCase()).filter((currency) => Boolean(getCurrencyMeta(currency))))].sort();
}

function accountDto(account: LunchFlowAccount, mapping: LunchFlowMapping | null, currencies: string[], providerError?: string) {
  const statusError = account.status.toUpperCase() === 'ACTIVE' ? null : 'Account is not active in Lunch Flow.';
  return {
    providerAccountId: account.id,
    name: account.name,
    institution: account.institutionName,
    currencies: [...new Set(currencies)].sort(),
    selected: Boolean(mapping?.enabled),
    accountId: mapping?.accountId ?? null,
    kind: mapping?.kind ?? null,
    currency: mapping?.currency ?? null,
    lastSyncedAt: mapping?.lastSyncedAt ?? null,
    lastError: statusError ?? mapping?.lastError ?? providerError ?? null,
  };
}

function mappingDto(mapping: LunchFlowMapping, lastError = mapping.lastError) {
  return {
    providerAccountId: mapping.providerAccountId,
    name: mapping.name,
    institution: mapping.institution,
    currencies: mapping.currency ? [mapping.currency] : [],
    selected: mapping.enabled,
    accountId: mapping.accountId,
    kind: mapping.kind,
    currency: mapping.currency,
    lastSyncedAt: mapping.lastSyncedAt,
    lastError,
  };
}

function localMappingDto(mapping: LunchFlowMapping) {
  return { ...mappingDto(mapping), lastAttemptAt: mapping.updatedAt };
}

function staleAccountDto(mapping: LunchFlowMapping) {
  return mappingDto(mapping, mapping.lastError ?? 'Account is no longer available from Lunch Flow.');
}

function newestFirst(left: LunchFlowMapping, right: LunchFlowMapping) {
  return right.updatedAt.localeCompare(left.updatedAt) || right.providerAccountId.localeCompare(left.providerAccountId);
}

function cappedAccounts<T>(accounts: readonly T[]) {
  const visible = accounts.slice(0, MAX_ACCOUNT_RESPONSE);
  const archivedAccountCount = accounts.length - visible.length;
  return archivedAccountCount > 0 ? { accounts: visible, archivedAccountCount } : { accounts: visible };
}

function queueMessage(context: LedgerContext, revisions: readonly LunchFlowRevision[]) {
  return { type: 'lunchflow-sync' as const, userId: context.userId, ledgerId: context.ledgerId, accounts: revisions.map(({ providerAccountId, revision }) => ({ providerAccountId, revision })) };
}

async function mapWithConcurrency<T, R>(values: readonly T[], limit: number, mapper: (value: T) => Promise<R>) {
  const results = new Array<R>(values.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= values.length) return;
      results[index] = await mapper(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return results;
}

async function queueSync(env: LunchFlowServiceEnv, context: FinancialContext, revisions: readonly LunchFlowRevision[]) {
  await assertFinancialAuthority(env.DB, context, 'connections:manage');
  if (revisions.length === 0) return false;
  if (revisions.length > MAX_LUNCHFLOW_ACCOUNTS) {
    throw new LunchFlowServiceError(
      'too_many_accounts',
      'Lunch Flow returned more than 25 selected accounts. Narrow the Lunch Flow Personal API scope before syncing.',
      422,
      false,
    );
  }
  if (!env.SYNC_QUEUE) throw new LunchFlowServiceError('queue_unavailable', 'The Lunch Flow sync could not be queued.', 503, true);
  try {
    await env.SYNC_QUEUE.send(queueMessage(context, revisions));
    return true;
  } catch {
    throw new LunchFlowServiceError('queue_unavailable', 'The Lunch Flow sync could not be queued.', 503, true);
  }
}

async function selectionCurrencies(provider: LunchFlowProvider, account: LunchFlowAccount, requested: string) {
  const currencies = await currenciesFor(provider, account);
  if (!currencies.includes(requested)) throw selectionError('currency_not_verified', 'The selected currency was not returned by Lunch Flow for this account.');
}

async function discoveredAccountDto(provider: LunchFlowProvider, account: LunchFlowAccount, mapping: LunchFlowMapping | null) {
  try {
    return accountDto(account, mapping, await currenciesFor(provider, account));
  } catch (error) {
    const normalized = safeProviderError(error);
    return accountDto(account, mapping, mapping?.currency ? [mapping.currency] : [], normalized.message);
  }
}

interface NormalizedSelectionRequest {
  ownerSubjectHash: string;
  idempotencyKey?: string;
  requestDigest: string;
  requested: Array<{
    providerAccountId: string;
    currency: string;
    kind: 'chequing' | 'savings' | 'credit';
  }>;
}

function requireConfigured(env: LunchFlowServiceEnv, context: LedgerContext) {
  if (!configured(env, context)) throw new LunchFlowServiceError('configuration', 'Lunch Flow is not configured on the Worker.', 503, false);
}

async function normalizeSelectionInput(input: LunchFlowSelectionInput): Promise<NormalizedSelectionRequest> {
  if (!Array.isArray(input.accounts) || input.accounts.length > MAX_LUNCHFLOW_ACCOUNTS) throw selectionError('invalid_selection', 'At most 25 Lunch Flow accounts may be selected.');
  const requested = input.accounts.map((item) => ({
    providerAccountId: normalizedProviderId(item.providerAccountId),
    currency: normalizedCurrency(item.currency),
    kind: normalizedKind(item.kind),
  }));
  if (new Set(requested.map((item) => item.providerAccountId)).size !== requested.length) throw selectionError('invalid_selection', 'Each Lunch Flow account may be selected only once.');
  return {
    ownerSubjectHash: input.ownerSubjectHash ?? 'web-owner',
    idempotencyKey: input.idempotencyKey,
    requestDigest: await lunchFlowRequestDigest({ accounts: requested }),
    requested,
  };
}

async function replaySelection(env: LunchFlowServiceEnv, context: FinancialContext, request: NormalizedSelectionRequest) {
  if (!request.idempotencyKey) return null;
  const record = await readLunchFlowOperationRecord(env.DB, context, {
    ownerSubjectHash: request.ownerSubjectHash,
    operationKind: 'account-selection',
    idempotencyKey: request.idempotencyKey,
  }, request.requestDigest);
  if (!record || record.pending) return null;
  requireConfigured(env, context);
  await queueSync(env, context, record.revisions);
  return record.response as { selected: number; queued: boolean };
}

async function loadSelection(context: LedgerContext, provider: LunchFlowProvider, requested: NormalizedSelectionRequest['requested']) {
  let providerAccounts: LunchFlowAccount[];
  try {
    providerAccounts = await provider.listAccounts();
  } catch (error) {
    throw safeProviderError(error);
  }
  assertProviderAccountCount(providerAccounts);
  const byId = new Map(providerAccounts.map((account) => [account.id, account]));
  const selection = [];
  for (const item of requested) {
    const account = byId.get(item.providerAccountId);
    if (!account) throw selectionError('account_not_verified', 'One or more selected Lunch Flow accounts are no longer available.');
    if (account.status.toUpperCase() !== 'ACTIVE') throw selectionError('account_unavailable', 'One or more selected Lunch Flow accounts are not active.');
    try {
      await selectionCurrencies(provider, account, item.currency);
    } catch (error) {
      throw safeProviderError(error);
    }
    selection.push({
      providerAccountId: account.id,
      accountId: await lunchFlowLedgerAccountId(context, account.id),
      name: account.name,
      institution: account.institutionName,
      currency: item.currency,
      kind: item.kind,
    });
  }
  return selection;
}

async function syncRevision(env: LunchFlowServiceEnv, context: FinancialContext, provider: LunchFlowProvider, revision: LunchFlowRevision) {
  const mapping = await readLunchFlowMapping(env.DB, context, revision.providerAccountId);
  if (!isCurrentSyncMapping(mapping, revision)) return null;
  try {
    const rows = await provider.listTransactions(revision.providerAccountId);
    const mapped = await Promise.all(rows.map((row) => mapLunchFlowTransaction(row, revision.providerAccountId, mapping.accountId)));
    await publishLunchFlowSnapshot(env.DB, context, { revision: revision, transactions: mapped, syncedAt: now(env) });
    return null;
  } catch (error) {
    const normalized = safeProviderError(error);
    await recordLunchFlowError(env.DB, context, revision, normalized.message);
    return normalized;
  }
}

function isCurrentSyncMapping(mapping: LunchFlowMapping | null, revision: LunchFlowRevision): mapping is LunchFlowMapping & { accountId: string; currency: string } {
  return Boolean(mapping?.enabled && mapping.revision === revision.revision && mapping.accountId && mapping.currency);
}

export function createLunchFlowService(env: LunchFlowServiceEnv, binding: FinancialContext, suppliedProvider?: LunchFlowProvider) {
  const context: FinancialContext = Object.freeze({ ...binding,
    ...('scopes' in binding ? { scopes: Object.freeze([...binding.scopes]) } : {}),
  });
  async function activeProvider() {
    await assertFinancialAuthority(env.DB, context, 'connections:manage');
    requireConfigured(env, context);
    return suppliedProvider ?? createLunchFlowProvider(env);
  }
  const provider: LunchFlowProvider = {
    listAccounts: async () => (await activeProvider()).listAccounts(),
    listTransactions: async id => (await activeProvider()).listTransactions(id),
  };

  async function readAccounts(): Promise<LunchFlowAccountsResponse> {
    await assertFinancialAuthority(env.DB, context, 'connections:manage');
    if (!configured(env, context)) return { configured: false, accounts: [] };
    let providerAccounts: LunchFlowAccount[];
    try {
      providerAccounts = await provider.listAccounts();
    } catch (error) {
      throw safeProviderError(error);
    }
    assertProviderAccountCount(providerAccounts);
    const mappings = await readLunchFlowMappings(env.DB, context);
    const byId = new Map(mappings.map((mapping) => [mapping.providerAccountId, mapping]));
    for (const account of providerAccounts) byId.delete(account.id);
    const result = await mapWithConcurrency(providerAccounts, DISCOVERY_CONCURRENCY, (account) => (
      discoveredAccountDto(provider, account, mappings.find((value) => value.providerAccountId === account.id) ?? null)
    ));
    const staleMappings = [...byId.values()];
    const staleEnabled = staleMappings.filter((mapping) => mapping.enabled).sort(newestFirst).map(staleAccountDto);
    const staleDisabled = staleMappings.filter((mapping) => !mapping.enabled).sort(newestFirst).map(staleAccountDto);
    const providerSelected = result.filter((account) => account.selected);
    const providerAvailable = result.filter((account) => !account.selected);
    await assertFinancialAuthority(env.DB, context, 'connections:manage');
    return { configured: true, ...cappedAccounts([...providerSelected, ...staleEnabled, ...providerAvailable, ...staleDisabled]) };
  }

  async function readStatus(): Promise<LunchFlowAccountsResponse> {
    await assertFinancialAuthority(env.DB, context, 'connections:manage');
    const mappings = await readLunchFlowMappings(env.DB, context);
    const enabled = mappings.filter((mapping) => mapping.enabled).sort(newestFirst).map(localMappingDto);
    const disabled = mappings.filter((mapping) => !mapping.enabled).sort(newestFirst).map(localMappingDto);
    await assertFinancialAuthority(env.DB, context, 'connections:manage');
    return { configured: configured(env, context), ...cappedAccounts([...enabled, ...disabled]) };
  }

  async function selectAccounts(input: LunchFlowSelectionInput) {
    await assertFinancialAuthority(env.DB, context, 'connections:manage');
    const request = await normalizeSelectionInput(input);
    const replay = await replaySelection(env, context, request);
    if (replay) return replay;
    requireConfigured(env, context);
    if (request.requested.length > 0 && !env.SYNC_QUEUE) throw new LunchFlowServiceError('queue_unavailable', 'The Lunch Flow sync could not be queued.', 503, true);
    const selection = await loadSelection(context, provider, request.requested);
    const operationResponse = { selected: selection.length, queued: selection.length > 0 };
    const publication = await publishLunchFlowSelection(env.DB, context, selection, request.idempotencyKey ? {
      ownerSubjectHash: request.ownerSubjectHash,
      operationKind: 'account-selection',
      idempotencyKey: request.idempotencyKey,
      requestDigest: request.requestDigest,
      response: operationResponse,
      selection,
    } : undefined);
    if (publication.operation) {
      await queueSync(env, context, publication.operation.revisions);
      return publication.operation.response as { selected: number; queued: boolean };
    }
    const queued = await queueSync(env, context, publication.revisions);
    return { selected: selection.length, queued };
  }

  async function requestSync(ownerSubjectHash = 'web-owner', idempotencyKey?: string) {
    await assertFinancialAuthority(env.DB, context, 'connections:manage');
    const requestDigest = await lunchFlowRequestDigest({});
    if (idempotencyKey) {
      const record = await readLunchFlowOperationRecord(env.DB, context, {
        ownerSubjectHash,
        operationKind: 'sync',
        idempotencyKey,
      }, requestDigest);
      if (record && !record.pending) {
        requireConfigured(env, context);
        await queueSync(env, context, record.revisions);
        return record.response as { queued: boolean; accounts: number };
      }
    }
    requireConfigured(env, context);
    const mappings = await readLunchFlowMappings(env.DB, context, true);
    const revisions = mappings.map(({ providerAccountId, revision }) => ({ providerAccountId, revision }));
    const response = { queued: revisions.length > 0, accounts: mappings.length };
    if (idempotencyKey) await rememberLunchFlowOperation(env.DB, context, {
      ownerSubjectHash,
      operationKind: 'sync',
      idempotencyKey,
    }, { response, requestDigest, revisions });
    const queued = await queueSync(env, context, revisions);
    return { ...response, queued };
  }

  async function sync(revisions?: readonly LunchFlowRevision[]) {
    await assertFinancialAuthority(env.DB, context, 'connections:manage');
    requireConfigured(env, context);
    const selected = revisions ?? (await readLunchFlowMappings(env.DB, context, true)).map(({ providerAccountId, revision }) => ({ providerAccountId, revision }));
    const failures: LunchFlowError[] = [];
    for (const revision of selected) {
      const failure = await syncRevision(env, context, provider, revision);
      if (failure) failures.push(failure);
    }
    if (failures.length > 0) throw failures.find((failure) => failure.retryable) ?? failures[0];
    return { accounts: selected.length };
  }

  return { readAccounts, readStatus, selectAccounts, requestSync, sync, provider };
}

export async function processLunchFlowSync(service: ReturnType<typeof createLunchFlowService>, revisions: readonly LunchFlowRevision[]) {
  return service.sync(revisions);
}

export async function readLunchFlowAccounts(env: LunchFlowServiceEnv, context: FinancialContext, provider?: LunchFlowProvider) {
  return createLunchFlowService(env, context, provider).readAccounts();
}
