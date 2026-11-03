import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WealthController } from '../mobile/src/features/wealth/WealthController';
import type { WealthPorts, WealthWireSnapshot } from '../mobile/src/features/wealth/contracts';
import { errorState } from '../mobile/src/features/finance/model';

const snapshot: WealthWireSnapshot = {
  asOf: '2026-11-02T12:00:00Z',
  stale: false,
  accounts: [{ id: 'brokerage', name: 'Long view', kind: 'brokerage', mode: 'holdings', currency: 'CAD' }],
  positions: [{
    accountId: 'brokerage', instrument: { exchange: 'TSX', ticker: 'SHOP', type: 'stock', currency: 'CAD' },
    quantity: '2', costBasisMinor: 18000, basisKnown: true, realizedGainMinor: 1000,
    valuation: { accountId: 'brokerage', instrument: { exchange: 'TSX', ticker: 'SHOP', type: 'stock', currency: 'CAD' }, asOf: '2026-11-02', priceMinor: 10000, source: 'manual' }, marketValueMinor: 20000, unrealizedGainMinor: 2000,
  }],
  cash: [{ accountId: 'brokerage', currency: 'CAD', amountMinor: 5000 }],
  totalByCurrency: { CAD: 25000 },
  history: [{ date: '2026-11-01', totals: { CAD: 24500 }, complete: true }],
  cashFlows: [{ sourceId: 'flow', date: '2026-11-01', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 500 }, classification: 'external_contribution', includedInPerformance: true, reason: 'linked contribution' }],
  modifiedDietz: { value: 0.02, available: true, reason: null },
  quote: { configured: false, provider: null, lastRefreshedAt: null },
  csv: { template: 'date,accountId,kind', previewId: null, rowCount: 0, errors: [], duplicates: [] },
};

function ports(): WealthPorts {
  return {
    read: vi.fn(async () => JSON.stringify(snapshot)),
    startWrite: vi.fn(async () => ({ operationId: 'wealth-op', kind: 'wealth_write', status: 'completed', updatedAt: 'now', resultId: null })),
    readOperations: vi.fn(async () => []),
    queryOperation: vi.fn(async () => null),
    onChanged: vi.fn(() => ({ remove: vi.fn() })),
  };
}

describe('mobile Wealth controller', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('loads a report without fabricating missing values and exposes all three subviews', async () => {
    const controller = new WealthController(ports());
    await controller.start();

    expect(controller.state.current().data?.totalByCurrency.CAD).toBe(25000);
    expect(controller.views).toEqual(['overview', 'investments', 'cash-flow']);
    expect(controller.state.current().data?.positions[0].valuation?.priceMinor).toBe(10000);
    controller.dispose();
  });

  it('treats a missing Wealth scope as a locked session that needs sign-in again', () => {
    expect(errorState({ code: 'wealth_scope_required' })).toEqual({ phase: 'locked', message: 'Renew your owner session to continue.' });
  });

  it('refreshes after a completed append-only write and fences concurrent stale reads', async () => {
    const p = ports();
    let resolve!: (value: string) => void;
    const pending = new Promise<string>((done) => { resolve = done; });
    vi.mocked(p.read).mockResolvedValueOnce(JSON.stringify(snapshot)).mockReturnValueOnce(pending).mockResolvedValue(JSON.stringify({ ...snapshot, asOf: 'later' }));
    const controller = new WealthController(p);
    await controller.start();
    const reload = controller.load();
    await controller.write('event', JSON.stringify({ kind: 'buy' }), 'wealth-op');
    resolve(JSON.stringify({ ...snapshot, asOf: 'stale' }));
    await reload;

    expect(controller.state.current().data?.asOf).toBe('later');
    expect(p.startWrite).toHaveBeenCalledWith('wealth-op', 'event', JSON.stringify({ kind: 'buy' }));
    controller.dispose();
  });

  it('unblocks the next typed save after a revision conflict while keeping the journal retryable', async () => {
    const p = ports();
    vi.mocked(p.startWrite)
      .mockResolvedValueOnce({ operationId: 'wealth-op', kind: 'wealth_event', status: 'revision_conflict', updatedAt: 'now', resultId: null })
      .mockResolvedValueOnce({ operationId: 'wealth-op-retry', kind: 'wealth_event', status: 'completed', updatedAt: 'later', resultId: null });
    const controller = new WealthController(p);
    await controller.start();

    await controller.write('event', JSON.stringify({ kind: 'buy', expectedRevision: 4 }), 'wealth-op');
    expect(controller.mutation.current().status).toBe('revision_conflict');
    await controller.write('event', JSON.stringify({ kind: 'buy', expectedRevision: 5 }), 'wealth-op-retry');

    expect(p.startWrite).toHaveBeenNthCalledWith(2, 'wealth-op-retry', 'event', JSON.stringify({ kind: 'buy', expectedRevision: 5 }));
    expect(controller.mutation.current().status).toBe('completed');
    controller.dispose();
  });

  it('reads a native CSV preview after an asynchronous picker settles', async () => {
    const p = ports();
    p.queryOperation = vi.fn(async () => ({ operationId: 'pick', kind: 'wealth_csv-preview', status: 'completed', updatedAt: 'now', resultId: null }));
    p.readCsvPreview = vi.fn(async () => '{"previewId":"preview-1"}');
    const controller = new WealthController(p);

    await expect(controller.resumeCsvImport('pick')).resolves.toBe('{"previewId":"preview-1"}');
    expect(p.readCsvPreview).toHaveBeenCalledWith('pick');
    controller.dispose();
  });

  it('re-previews the owner-fenced source CSV with a typed canonical mapping', async () => {
    const p = ports();
    p.startCsvRemap = vi.fn(async () => ({ operationId: 'mapped', kind: 'wealth_csv-preview', status: 'completed', updatedAt: 'now', resultId: null }));
    p.queryOperation = vi.fn(async () => ({ operationId: 'mapped', kind: 'wealth_csv-preview', status: 'completed', updatedAt: 'now', resultId: null }));
    p.readCsvPreview = vi.fn(async () => '{"previewId":"preview-mapped","sourceHeaders":["posted"],"canonicalHeaders":["date"]}');
    const controller = new WealthController(p);

    await controller.start();
    await expect(controller.remapCsv('pick', 'mapped', { date: 'posted' })).resolves.toContain('preview-mapped');
    expect(p.startCsvRemap).toHaveBeenCalledWith('pick', 'mapped', { date: 'posted' });
    expect(p.readCsvPreview).toHaveBeenCalledWith('mapped');
    controller.dispose();
  });
});
