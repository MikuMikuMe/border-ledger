import { OWNER_LEDGER } from './helpers/tenants';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSqliteD1Fixture } from './helpers/sqlite-d1';
import type { D1Database, D1Statement } from '../worker/db-types';
import {
  createLunchFlowProvider,
  LunchFlowError,
  mapLunchFlowTransaction,
  type LunchFlowAccount,
  type LunchFlowTransaction,
} from '../worker/lunchflow';
import {
  createLunchFlowService,
  processLunchFlowSync,
  type LunchFlowProvider,
} from '../worker/lunchflow-service';

const fixtures: Array<{ close(): void }> = [];

afterEach(() => {
  vi.restoreAllMocks();
  while (fixtures.length > 0) fixtures.pop()?.close();
});

function providerAccount(overrides: Partial<LunchFlowAccount> = {}): LunchFlowAccount {
  return {
    id: 'account-synthetic-1',
    name: 'Synthetic chequing',
    institutionName: 'Synthetic Bank',
    status: 'ACTIVE',
    currency: 'CAD',
    ...overrides,
  };
}

function providerTransaction(overrides: Partial<LunchFlowTransaction> = {}): LunchFlowTransaction {
  return {
    id: 'transaction-synthetic-1',
    accountId: 'account-synthetic-1',
    amount: -12.34,
    currency: 'CAD',
    date: '2026-10-20',
    merchant: 'Synthetic Cafe',
    description: 'Synthetic Cafe purchase',
    isPending: false,
    ...overrides,
  };
}

function serviceEnv(db: D1Database, queue?: { send(message: unknown): Promise<void> }) {
  return {
    DB: db,
    LUNCHFLOW_API_KEY: 'test-key-never-real',
    SYNC_QUEUE: queue,
    now: () => new Date('2026-10-22T12:00:00.000Z'),
  };
}

describe('Lunch Flow adapter', () => {
  it('discovers accounts at the canonical host without following credential-bearing redirects', async () => {
    const fetcher: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      expect(request.redirect).toBe('error');
      expect(request.headers.get('x-api-key')).toBe('server-only-test-key');
      // The apex host redirects to www; fetch with redirect:error rejects it.
      if (new URL(request.url).hostname === 'lunchflow.app') throw new TypeError('Redirect rejected');
      expect(request.url).toBe('https://www.lunchflow.app/api/v1/accounts');
      return Response.json({ accounts: [{ id: 'one', name: 'Test', status: 'ACTIVE' }], total: 1 });
    };
    const provider = createLunchFlowProvider({ LUNCHFLOW_API_KEY: 'server-only-test-key' }, fetcher);
    await expect(provider.listAccounts()).resolves.toMatchObject([{ id: 'one' }]);
  });

  it('sends the server-only key and includes pending rows in a complete snapshot request', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      expect(request.headers.get('x-api-key')).toBe('server-only-test-key');
      expect(new URL(request.url).searchParams.get('include_pending')).toBe('true');
      return new Response(JSON.stringify({ transactions: [providerTransaction()], total: 1 }), { status: 200 });
    });
    const provider = createLunchFlowProvider({ LUNCHFLOW_API_KEY: 'server-only-test-key' }, fetcher as unknown as typeof fetch);

    await expect(provider.listTransactions('account-synthetic-1')).resolves.toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects an incomplete total before any transaction can be published', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      transactions: [providerTransaction()],
      total: 2,
    }), { status: 200 }));
    const provider = createLunchFlowProvider({ LUNCHFLOW_API_KEY: 'server-only-test-key' }, fetcher as unknown as typeof fetch);

    await expect(provider.listTransactions('account-synthetic-1')).rejects.toMatchObject({ code: 'incomplete_snapshot' });
  });

  it('rejects a transaction with a missing pending flag', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      transactions: [{ ...providerTransaction(), isPending: undefined }],
      total: 1,
    }), { status: 200 }));
    const provider = createLunchFlowProvider({ LUNCHFLOW_API_KEY: 'server-only-test-key' }, fetcher as unknown as typeof fetch);

    await expect(provider.listTransactions('account-synthetic-1')).rejects.toMatchObject({ code: 'malformed_response' });
  });

  it.each([429, 500])('classifies malformed HTTP %s responses as retryable provider failures', async (status) => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('{ malformed', { status }));
    const provider = createLunchFlowProvider({ LUNCHFLOW_API_KEY: 'server-only-test-key' }, fetcher as unknown as typeof fetch);

    await expect(provider.listTransactions('account-synthetic-1')).rejects.toMatchObject({
      code: 'provider_rejected', status: 503, retryable: true,
    });
  });

  it('classifies a malformed non-retryable HTTP response without parsing its body', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 304 }));
    const provider = createLunchFlowProvider({ LUNCHFLOW_API_KEY: 'server-only-test-key' }, fetcher as unknown as typeof fetch);

    await expect(provider.listTransactions('account-synthetic-1')).rejects.toMatchObject({
      code: 'provider_rejected', status: 502, retryable: false,
    });
  });

  it('maps signed provider amounts using the registry precision and hashes the exact source identity', async () => {
    const mapped = await mapLunchFlowTransaction(providerTransaction({ amount: -1.234, currency: 'TND' }), 'account-synthetic-1');

    expect(mapped).toMatchObject({
      amountMinor: -1234,
      currency: 'TND',
      kind: 'expense',
      status: 'confirmed',
      source: 'lunchflow',
      fingerprint: 'lunchflow:account-synthetic-1:transaction-synthetic-1',
    });
    expect(mapped.id).toMatch(/^lunchflow-[a-f0-9]{64}$/);
  });
});

describe('Lunch Flow selection and sync', () => {
  async function setup(provider: LunchFlowProvider) {
    const fixture = createSqliteD1Fixture();
    fixtures.push(fixture);
    const queued: unknown[] = [];
    const service = createLunchFlowService(serviceEnv(fixture.db, { send: async (message) => { queued.push(message); } }), OWNER_LEDGER, provider);
    return { fixture, service, queued };
  }

  it('reads local mapping status without querying Lunch Flow and preserves disabled mappings', async () => {
    const fixture = createSqliteD1Fixture();
    fixtures.push(fixture);
    await fixture.db.batch([
      fixture.db.prepare('INSERT INTO accounts (id, name, institution, currency, kind, status) VALUES (?, ?, ?, ?, ?, ?)')
        .bind('local-account-disabled', 'Disabled account', 'Synthetic Bank', 'CAD', 'savings', 'connected'),
      fixture.db.prepare('INSERT INTO accounts (id, name, institution, currency, kind, status) VALUES (?, ?, ?, ?, ?, ?)')
        .bind('local-account-enabled', 'Enabled account', 'Synthetic Bank', 'CAD', 'chequing', 'connected'),
      fixture.db.prepare(`INSERT INTO lunchflow_accounts
        (provider_account_id, account_id, ledger_id, name, institution, currency, kind, enabled, revision, last_synced_at, last_error)
        VALUES (?, ?, 'personal', ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind('local-disabled', 'local-account-disabled', 'Disabled account', 'Synthetic Bank', 'CAD', 'savings', 0, 2, null, null),
      fixture.db.prepare(`INSERT INTO lunchflow_accounts
        (provider_account_id, account_id, ledger_id, name, institution, currency, kind, enabled, revision, last_synced_at, last_error)
        VALUES (?, ?, 'personal', ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind('local-enabled', 'local-account-enabled', 'Enabled account', 'Synthetic Bank', 'CAD', 'chequing', 1, 4, '2026-10-22T12:00:00.000Z', 'Provider unavailable.'),
    ]);
    let providerReads = 0;
    const provider: LunchFlowProvider = {
      async listAccounts() { providerReads += 1; throw new Error('local status must not query provider'); },
      async listTransactions() { throw new Error('local status must not query provider'); },
    };
    const service = createLunchFlowService(serviceEnv(fixture.db), OWNER_LEDGER, provider);

    await expect(service.readStatus()).resolves.toEqual({
      configured: true,connectionId:'lunchflow-personal-owner',generation:1,
      accounts: [
        {
          providerAccountId: 'local-enabled',connectionId:'lunchflow-personal-owner',providerBankConnectionId:null,
          name: 'Enabled account',
          institution: 'Synthetic Bank',
          currencies: ['CAD'],
          selected: true,
          accountId: 'local-account-enabled',
          kind: 'chequing',
          currency: 'CAD',
          lastSyncedAt: '2026-10-22T12:00:00.000Z',
          lastAttemptAt: expect.any(String),
          lastError: 'Provider unavailable.',
        },
        {
          providerAccountId: 'local-disabled',connectionId:'lunchflow-personal-owner',providerBankConnectionId:null,
          name: 'Disabled account',
          institution: 'Synthetic Bank',
          currencies: ['CAD'],
          selected: false,
          accountId: 'local-account-disabled',
          kind: 'savings',
          currency: 'CAD',
          lastSyncedAt: null,
          lastAttemptAt: expect.any(String),
          lastError: null,
        },
      ],
    });
    expect(providerReads).toBe(0);
  });

  it('caps account history responses while retaining selected mappings and newest archived rows', async () => {
    const fixture = createSqliteD1Fixture();
    fixtures.push(fixture);
    const writes: D1Statement[] = [
      fixture.db.prepare('INSERT INTO accounts (id, name, institution, currency, kind, status) VALUES (?, ?, ?, ?, ?, ?)')
        .bind('local-selected', 'Selected account', 'Synthetic Bank', 'CAD', 'chequing', 'connected'),
      fixture.db.prepare(`INSERT INTO lunchflow_accounts
        (provider_account_id, account_id, ledger_id, name, institution, currency, kind, enabled, revision, updated_at)
        VALUES (?, ?, 'personal', ?, ?, ?, ?, 1, ?, ?)`)
        .bind('local-selected', 'local-selected', 'Selected account', 'Synthetic Bank', 'CAD', 'chequing', 2, '2026-10-22T12:00:00.000Z'),
    ];
    for (let index = 0; index < 105; index += 1) {
      const providerAccountId = `history-${String(index).padStart(3, '0')}`;
      const accountId = `history-account-${String(index).padStart(3, '0')}`;
      const updatedAt = new Date(Date.UTC(2026, 0, index + 1)).toISOString();
      writes.push(
        fixture.db.prepare('INSERT INTO accounts (id, name, institution, currency, kind, status) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(accountId, `History ${index}`, 'Synthetic Bank', 'CAD', 'savings', 'connected'),
        fixture.db.prepare(`INSERT INTO lunchflow_accounts
          (provider_account_id, account_id, ledger_id, name, institution, currency, kind, enabled, revision, updated_at)
          VALUES (?, ?, 'personal', ?, ?, ?, ?, 0, 1, ?)`)
          .bind(providerAccountId, accountId, `History ${index}`, 'Synthetic Bank', 'CAD', 'savings', updatedAt),
      );
    }
    await fixture.db.batch(writes);
    const provider: LunchFlowProvider = {
      async listAccounts() { throw new Error('local status must not query provider'); },
      async listTransactions() { throw new Error('local status must not query provider'); },
    };
    const service = createLunchFlowService(serviceEnv(fixture.db), OWNER_LEDGER, provider);

    const response = await service.readStatus();
    expect(response.accounts).toHaveLength(100);
    expect(response.accounts[0].providerAccountId).toBe('local-selected');
    expect(response.accounts.filter((account) => account.selected)).toHaveLength(1);
    expect(response.accounts.some((account) => account.providerAccountId === 'history-104')).toBe(true);
    expect(response.accounts.some((account) => account.providerAccountId === 'history-000')).toBe(false);
    expect(response.archivedAccountCount).toBe(6);
    await expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM lunchflow_accounts').first<{ count: number }>())
      .resolves.toMatchObject({ count: 106 });
  });

  it('marks inactive provider accounts unavailable even when their currency is valid', async () => {
    const fixture = createSqliteD1Fixture();
    fixtures.push(fixture);
    const provider: LunchFlowProvider = {
      async listAccounts() { return [providerAccount({ status: 'DISCONNECTED' })]; },
      async listTransactions() { throw new Error('inactive account should not need currency discovery'); },
    };
    const service = createLunchFlowService(serviceEnv(fixture.db), OWNER_LEDGER, provider);

    await expect(service.readAccounts()).resolves.toMatchObject({
      accounts: [{ providerAccountId: 'account-synthetic-1', currencies: ['CAD'], lastError: 'Account is not active in Lunch Flow.' }],
    });
  });

  it('replaces selection, creates a dedicated account, queues a revision-fenced sync, and replays mobile idempotency', async () => {
    const provider: LunchFlowProvider = {
      async listAccounts() { return [providerAccount()]; },
      async listTransactions() { return [providerTransaction()]; },
    };
    const { fixture, service, queued } = await setup(provider);

    const first = await service.selectAccounts({
      accounts: [{ providerAccountId: 'account-synthetic-1', currency: 'CAD', kind: 'chequing' }],
      ownerSubjectHash: 'owner-synthetic',
      idempotencyKey: 'selection-1',
    });
    const replay = await service.selectAccounts({
      accounts: [{ providerAccountId: 'account-synthetic-1', currency: 'CAD', kind: 'chequing' }],
      ownerSubjectHash: 'owner-synthetic',
      idempotencyKey: 'selection-1',
    });

    expect(first).toEqual({ selected: 1, queued: true });
    expect(replay).toEqual(first);
    expect(queued).toEqual([
      { type: 'lunchflow-sync', ...OWNER_LEDGER, connectionId:'lunchflow-personal-owner',generation:1, accounts: [{ providerAccountId: 'account-synthetic-1', revision: 1 }] },
      { type: 'lunchflow-sync', ...OWNER_LEDGER, connectionId:'lunchflow-personal-owner',generation:1, accounts: [{ providerAccountId: 'account-synthetic-1', revision: 1 }] },
    ]);
    await expect(fixture.db.prepare('SELECT account_id, enabled, revision FROM lunchflow_accounts').all()).resolves.toMatchObject({ results: [{ enabled: 1, revision: 1 }] });
  });

  it('rejects reuse of an idempotency key with a different selection body', async () => {
    const provider: LunchFlowProvider = {
      async listAccounts() { return [providerAccount()]; },
      async listTransactions() { return [providerTransaction()]; },
    };
    const { service } = await setup(provider);
    await service.selectAccounts({
      accounts: [{ providerAccountId: 'account-synthetic-1', currency: 'CAD', kind: 'chequing' }],
      ownerSubjectHash: 'owner-synthetic',
      idempotencyKey: 'selection-conflict',
    });

    await expect(service.selectAccounts({
      accounts: [{ providerAccountId: 'account-synthetic-1', currency: 'CAD', kind: 'credit' }],
      ownerSubjectHash: 'owner-synthetic',
      idempotencyKey: 'selection-conflict',
    })).rejects.toMatchObject({ code: 'idempotency_conflict', status: 409 });
  });

  it('serializes concurrent replacements and keeps each queued revision fenced', async () => {
    const second = providerAccount({ id: 'account-synthetic-2', name: 'Synthetic savings', currency: 'USD' });
    let accountReads = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const provider: LunchFlowProvider = {
      async listAccounts() {
        accountReads += 1;
        if (accountReads === 2) release();
        await barrier;
        return [providerAccount(), second];
      },
      async listTransactions() { return []; },
    };
    const { fixture, service, queued } = await setup(provider);
    const first = service.selectAccounts({
      accounts: [{ providerAccountId: 'account-synthetic-1', currency: 'CAD', kind: 'chequing' }],
      ownerSubjectHash: 'owner-concurrent-a',
      idempotencyKey: 'selection-concurrent-a',
    });
    const replacement = service.selectAccounts({
      accounts: [{ providerAccountId: 'account-synthetic-2', currency: 'USD', kind: 'savings' }],
      ownerSubjectHash: 'owner-concurrent-b',
      idempotencyKey: 'selection-concurrent-b',
    });
    await expect(Promise.all([first, replacement])).resolves.toEqual([
      { selected: 1, queued: true },
      { selected: 1, queued: true },
    ]);

    expect(queued).toHaveLength(2);
    expect(queued.flatMap((message) => (message as { accounts: Array<{ providerAccountId: string; revision: number }> }).accounts))
      .toEqual(expect.arrayContaining([
        { providerAccountId: 'account-synthetic-1', revision: 1 },
        { providerAccountId: 'account-synthetic-2', revision: 1 },
      ]));
    const mappings = await fixture.db.prepare(`SELECT provider_account_id, enabled, revision
      FROM lunchflow_accounts ORDER BY provider_account_id`).all<{ provider_account_id: string; enabled: number; revision: number }>();
    expect(mappings.results.filter((mapping) => mapping.enabled === 1)).toHaveLength(1);
    expect(mappings.results.filter((mapping) => mapping.enabled === 0)).toHaveLength(1);
    expect(mappings.results.find((mapping) => mapping.enabled === 1)?.revision).toBe(1);
    expect(mappings.results.find((mapping) => mapping.enabled === 0)?.revision).toBe(2);
  });

  it('claims a concurrent idempotency key once and rejects a different body', async () => {
    let accountReads = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const provider: LunchFlowProvider = {
      async listAccounts() {
        accountReads += 1;
        if (accountReads === 2) release();
        await barrier;
        return [providerAccount()];
      },
      async listTransactions() { return []; },
    };
    const { fixture, service, queued } = await setup(provider);
    const input = {
      ownerSubjectHash: 'owner-concurrent-same-key',
      idempotencyKey: 'selection-concurrent-same-key',
    };
    const first = service.selectAccounts({
      ...input,
      accounts: [{ providerAccountId: 'account-synthetic-1', currency: 'CAD', kind: 'chequing' as const }],
    });
    const conflict = service.selectAccounts({
      ...input,
      accounts: [{ providerAccountId: 'account-synthetic-1', currency: 'CAD', kind: 'credit' as const }],
    });
    const results = await Promise.allSettled([first, conflict]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(results.find((result) => result.status === 'fulfilled')).toMatchObject({ value: { selected: 1, queued: true } });
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { code: 'idempotency_conflict', status: 409 } });
    expect(queued).toHaveLength(1);
    await expect(fixture.db.prepare('SELECT enabled, revision FROM lunchflow_accounts').first<{ enabled: number; revision: number }>())
      .resolves.toMatchObject({ enabled: 1, revision: 1 });
  });

  it('persists the selection receipt before queue delivery and retries the frozen revision', async () => {
    const fixture = createSqliteD1Fixture();
    fixtures.push(fixture);
    let fail = true;
    let accountReads = 0;
    const queued: unknown[] = [];
    const provider: LunchFlowProvider = {
      async listAccounts() { accountReads += 1; return [providerAccount()]; },
      async listTransactions() { return [providerTransaction()]; },
    };
    const service = createLunchFlowService(serviceEnv(fixture.db, {
      send: async (message) => {
        if (fail) throw new Error('queue unavailable');
        queued.push(message);
      },
    }), OWNER_LEDGER, provider);
    const input = {
      accounts: [{ providerAccountId: 'account-synthetic-1', currency: 'CAD', kind: 'chequing' as const }],
      ownerSubjectHash: 'owner-synthetic',
      idempotencyKey: 'selection-delivery-retry',
    };

    await expect(service.selectAccounts(input)).rejects.toMatchObject({ code: 'queue_unavailable' });
    fail = false;
    await expect(service.selectAccounts(input)).resolves.toEqual({ selected: 1, queued: true });
    expect(accountReads).toBe(1);
    expect(queued).toEqual([{ type: 'lunchflow-sync', ...OWNER_LEDGER, connectionId:'lunchflow-personal-owner',generation:1, accounts: [{ providerAccountId: 'account-synthetic-1', revision: 1 }] }]);
    await expect(fixture.db.prepare('SELECT revision FROM lunchflow_accounts').first<{ revision: number }>()).resolves.toMatchObject({ revision: 1 });
  });

  it('fails selection when a nonempty sync cannot be queued', async () => {
    const fixture = createSqliteD1Fixture();
    fixtures.push(fixture);
    const provider: LunchFlowProvider = {
      async listAccounts() { return [providerAccount()]; },
      async listTransactions() { return [providerTransaction()]; },
    };
    const service = createLunchFlowService(serviceEnv(fixture.db), OWNER_LEDGER, provider);

    await expect(service.selectAccounts({
      accounts: [{ providerAccountId: 'account-synthetic-1', currency: 'CAD', kind: 'chequing' }],
    })).rejects.toMatchObject({ code: 'queue_unavailable', retryable: true });
    await expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM lunchflow_accounts').first<{ count: number }>()).resolves.toMatchObject({ count: 0 });
  });

  it('records a provider transaction in its own currency and upgrades the account to multi-currency', async () => {
    const provider: LunchFlowProvider = {
      async listAccounts() { return [providerAccount()]; },
      async listTransactions() { return [providerTransaction({ currency: 'USD' })]; },
    };
    const { fixture, service } = await setup(provider);
    await service.selectAccounts({ accounts: [{ providerAccountId: 'account-synthetic-1', currency: 'CAD', kind: 'chequing' }] });
    await processLunchFlowSync(service, [{ providerAccountId: 'account-synthetic-1', revision: 1 }]);

    await expect(fixture.db.prepare('SELECT currency_mode FROM accounts').first<{ currency_mode: string }>()).resolves.toMatchObject({ currency_mode: 'multi' });
    await expect(fixture.db.prepare('SELECT last_synced_at FROM accounts').first<{ last_synced_at: string }>()).resolves.toMatchObject({ last_synced_at: expect.any(String) });
    await expect(fixture.db.prepare('SELECT currency FROM account_currencies ORDER BY currency').all<{ currency: string }>()).resolves.toMatchObject({ results: [{ currency: 'CAD' }, { currency: 'USD' }] });
    await expect(fixture.db.prepare("SELECT currency, amount_minor FROM transactions WHERE source = 'lunchflow'").first<{ currency: string; amount_minor: number }>()).resolves.toMatchObject({ currency: 'USD', amount_minor: -1234 });
  });

  it('publishes a full feed larger than D1 per-statement parameter limits atomically', async () => {
    const rows = Array.from({ length: 160 }, (_, index) => providerTransaction({
      id: `transaction-synthetic-${index + 10}`,
      amount: -(index + 1.25),
    }));
    const provider: LunchFlowProvider = {
      async listAccounts() { return [providerAccount()]; },
      async listTransactions() { return rows; },
    };
    const { fixture, service } = await setup(provider);
    await service.selectAccounts({ accounts: [{ providerAccountId: 'account-synthetic-1', currency: 'CAD', kind: 'chequing' }] });
    await processLunchFlowSync(service, [{ providerAccountId: 'account-synthetic-1', revision: 1 }]);

    await expect(fixture.db.prepare("SELECT COUNT(*) AS count FROM transactions WHERE source = 'lunchflow'").first<{ count: number }>()).resolves.toMatchObject({ count: 160 });
    await expect(fixture.db.prepare("SELECT COUNT(*) AS count FROM transaction_source_records WHERE source_kind = 'lunchflow'").first<{ count: number }>()).resolves.toMatchObject({ count: 160 });
  });

  it('fences a queued revision across deselection and reselection', async () => {
    const provider: LunchFlowProvider = {
      async listAccounts() { return [providerAccount()]; },
      async listTransactions() { return [providerTransaction()]; },
    };
    const { fixture, service, queued } = await setup(provider);
    await service.selectAccounts({ accounts: [{ providerAccountId: 'account-synthetic-1', currency: 'CAD', kind: 'chequing' }] });
    await service.selectAccounts({ accounts: [] });
    await service.selectAccounts({ accounts: [{ providerAccountId: 'account-synthetic-1', currency: 'CAD', kind: 'chequing' }] });

    expect(queued).toEqual([
      { type: 'lunchflow-sync', ...OWNER_LEDGER, connectionId:'lunchflow-personal-owner',generation:1, accounts: [{ providerAccountId: 'account-synthetic-1', revision: 1 }] },
      { type: 'lunchflow-sync', ...OWNER_LEDGER, connectionId:'lunchflow-personal-owner',generation:1, accounts: [{ providerAccountId: 'account-synthetic-1', revision: 3 }] },
    ]);
    await processLunchFlowSync(service, [{ providerAccountId: 'account-synthetic-1', revision: 1 }]);
    await expect(fixture.db.prepare("SELECT COUNT(*) AS count FROM transactions WHERE source = 'lunchflow'").first<{ count: number }>()).resolves.toMatchObject({ count: 0 });
    await processLunchFlowSync(service, [{ providerAccountId: 'account-synthetic-1', revision: 3 }]);
    await expect(fixture.db.prepare("SELECT COUNT(*) AS count FROM transactions WHERE source = 'lunchflow'").first<{ count: number }>()).resolves.toMatchObject({ count: 1 });
  });

  it('keeps posted history, reconciles pending rows by source identity, and removes only absent provisional rows', async () => {
    const snapshots: LunchFlowTransaction[][] = [
      [providerTransaction({ isPending: true }), providerTransaction({ id: 'transaction-synthetic-2', amount: -1.01, isPending: true })],
      [providerTransaction({ isPending: false })],
      [],
    ];
    const provider: LunchFlowProvider = {
      async listAccounts() { return [providerAccount()]; },
      async listTransactions() { return snapshots.shift() ?? []; },
    };
    const { fixture, service } = await setup(provider);
    await service.selectAccounts({ accounts: [{ providerAccountId: 'account-synthetic-1', currency: 'CAD', kind: 'chequing' }] });
    const sync = { providerAccountId: 'account-synthetic-1', revision: 1 };

    await processLunchFlowSync(service, [sync]);
    await processLunchFlowSync(service, [sync]);
    const afterPosted = await fixture.db.prepare('SELECT id, status, amount_minor FROM transactions').all<{ id: string; status: string; amount_minor: number }>();
    expect(afterPosted.results).toHaveLength(1);
    expect(afterPosted.results[0].status).toBe('confirmed');

    await processLunchFlowSync(service, [sync]);
    await expect(fixture.db.prepare("SELECT COUNT(*) AS count FROM transactions WHERE source = 'lunchflow'").first<{ count: number }>()).resolves.toMatchObject({ count: 1 });
  });

  it('records a safe provider failure while preserving the last-good transaction snapshot', async () => {
    let fail = false;
    const provider: LunchFlowProvider = {
      async listAccounts() { return [providerAccount()]; },
      async listTransactions() {
        if (fail) throw new Error('provider secret should never be persisted');
        return [providerTransaction()];
      },
    };
    const { fixture, service } = await setup(provider);
    await service.selectAccounts({ accounts: [{ providerAccountId: 'account-synthetic-1', currency: 'CAD', kind: 'chequing' }] });
    await processLunchFlowSync(service, [{ providerAccountId: 'account-synthetic-1', revision: 1 }]);
    fail = true;

    await expect(processLunchFlowSync(service, [{ providerAccountId: 'account-synthetic-1', revision: 1 }])).rejects.toMatchObject({ retryable: true });
    await expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM transactions').first<{ count: number }>()).resolves.toMatchObject({ count: 1 });
    const row = await fixture.db.prepare('SELECT last_synced_at, last_error FROM lunchflow_accounts').first<{ last_synced_at: string; last_error: string }>();
    expect(row?.last_synced_at).toBeTruthy();
    expect(row?.last_error).not.toContain('provider secret');
  });

  it('returns a retryable failure when a mixed sync has any retryable account failure', async () => {
    const second = providerAccount({ id: 'account-synthetic-2', name: 'Synthetic savings', currency: 'USD' });
    const provider: LunchFlowProvider = {
      async listAccounts() { return [providerAccount(), second]; },
      async listTransactions(providerAccountId) {
        if (providerAccountId === 'account-synthetic-1') throw new LunchFlowError('provider_rejected', 'A permanent provider failure.', 502, false);
        throw new LunchFlowError('provider_unavailable', 'A temporary provider failure.', 503, true);
      },
    };
    const { service } = await setup(provider);
    await service.selectAccounts({ accounts: [
      { providerAccountId: 'account-synthetic-1', currency: 'CAD', kind: 'chequing' },
      { providerAccountId: 'account-synthetic-2', currency: 'USD', kind: 'savings' },
    ] });

    await expect(processLunchFlowSync(service, [
      { providerAccountId: 'account-synthetic-1', revision: 1 },
      { providerAccountId: 'account-synthetic-2', revision: 1 },
    ])).rejects.toMatchObject({ code: 'provider_unavailable', retryable: true });
  });
});
