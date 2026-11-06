import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({ getSnapshot: vi.fn(), readAccounts: vi.fn(), readSnapshot: vi.fn(), readTransactions: vi.fn(), readQuoteSettings: vi.fn(), readEvents: vi.fn(), readValuations: vi.fn(), readTemplate: vi.fn(), startCsvImport: vi.fn(), startCsvTemplate: vi.fn(), readCsvPreview: vi.fn(), startWrite: vi.fn() }));
vi.mock('../mobile/node_modules/react-native/index.js', () => ({ TurboModuleRegistry: { getEnforcing: () => bridge } }));
vi.mock('../mobile/src/native/specs/NativeWealth', () => ({ default: bridge }));

const { nativeWealthService } = await import('../mobile/src/features/wealth/wealthService');

describe('native Wealth service', () => {
  beforeEach(() => vi.resetAllMocks());

  it('keeps the owner route and query structure inside the native adapter', async () => {
    bridge.readSnapshot.mockResolvedValue('{}');
    await nativeWealthService.read({ view: 'investments', accountId: 'brokerage', periodStart: '2026-01-01', periodEnd: '2026-11-02' });
    expect(bridge.readSnapshot).toHaveBeenCalledWith({ view: 'investments', accountId: 'brokerage', exchange: null, ticker: null, asOf: null, periodStart: '2026-01-01', periodEnd: '2026-11-02' });
  });

  it('passes writes through the operation lifecycle without persisting secrets in JavaScript', async () => {
    bridge.startWrite.mockResolvedValue({ operationId: 'op', status: 'completed' });
    const body = JSON.stringify({ action: 'quote-save', key: 'secret-only-in-native-boundary' });
    await nativeWealthService.startWrite('op', 'quote-save', body);
    expect(bridge.startWrite).toHaveBeenCalledWith('op', 'quote-save', body);
  });

  it('reads quote provider metadata through the native boundary', async () => {
    bridge.readQuoteSettings.mockResolvedValue('{"providers":[]}');
    await nativeWealthService.readQuoteSettings?.();
    expect(bridge.readQuoteSettings).toHaveBeenCalledTimes(1);
  });

  it('reads confirmed bank records through the existing authenticated ledger capability', async () => {
    bridge.readTransactions
      .mockResolvedValueOnce({ items: [{ id: 'tx-1' }], nextCursor: 'transactions-page-2', limit: 100 })
      .mockResolvedValueOnce({ items: [{ id: 'tx-2' }], nextCursor: null, limit: 100 });
    await expect(nativeWealthService.readBankTransactions?.()).resolves.toMatchObject([{ id: 'tx-1' }, { id: 'tx-2' }]);
    expect(bridge.readTransactions).toHaveBeenCalledWith({ cursor: null, limit: 100, query: null, currency: null, status: 'confirmed', source: null, category: null });
    expect(bridge.readTransactions).toHaveBeenNthCalledWith(2, { cursor: 'transactions-page-2', limit: 100, query: null, currency: null, status: 'confirmed', source: null, category: null });
  });

  it('discovers zero-activity local accounts while paging provider metadata', async () => {
    bridge.getSnapshot.mockResolvedValue({ accounts: [{ id: 'ledger-quiet', displayName: 'Quiet chequing', institution: 'RBC', currencies: ['CAD'] }] });
    bridge.readAccounts
      .mockResolvedValueOnce({ accounts: [{ providerAccountId: 'provider-1', name: 'Quiet chequing', mask: null, subtype: 'checking', currency: 'CAD', kind: 'depository' }], nextCursor: 'page-2', limit: 100 })
      .mockResolvedValueOnce({ accounts: [{ providerAccountId: 'provider-2', name: 'Other savings', mask: null, subtype: 'savings', currency: 'USD', kind: 'depository' }], nextCursor: null, limit: 100 });
    await expect(nativeWealthService.readBankAccounts?.()).resolves.toEqual([{ id: 'ledger-quiet', name: 'Quiet chequing', institution: 'RBC', currencies: ['CAD'] }]);
    expect(bridge.readAccounts).toHaveBeenNthCalledWith(1, { cursor: null, limit: 100 });
    expect(bridge.readAccounts).toHaveBeenNthCalledWith(2, { cursor: 'page-2', limit: 100 });
  });

  it('keeps account detail and CSV picker work behind the native capability', async () => {
    bridge.readEvents.mockResolvedValue('{"events":[]}');
    bridge.readValuations.mockResolvedValue('{"valuations":[]}');
    bridge.startCsvImport.mockResolvedValue({ operationId: 'pick', status: 'awaiting_result' });
    bridge.startCsvTemplate.mockResolvedValue({ operationId: 'template', status: 'awaiting_result' });
    bridge.readCsvPreview.mockResolvedValue(null);

    await nativeWealthService.readEvents?.('brokerage');
    await nativeWealthService.readValuations?.('brokerage');
    await nativeWealthService.startCsvImport?.('pick');
    await nativeWealthService.startCsvTemplate?.('template');
    await nativeWealthService.readCsvPreview?.('pick');

    expect(bridge.readEvents).toHaveBeenCalledWith({ accountId: 'brokerage' });
    expect(bridge.readValuations).toHaveBeenCalledWith({ accountId: 'brokerage' });
    expect(bridge.startCsvImport).toHaveBeenCalledWith('pick');
    expect(bridge.startCsvTemplate).toHaveBeenCalledWith('template');
    expect(bridge.readCsvPreview).toHaveBeenCalledWith('pick');
  });
});
