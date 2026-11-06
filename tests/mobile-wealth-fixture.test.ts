import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  getLaunchScene: vi.fn(),
  pickCsv: vi.fn(),
  saveDocument: vi.fn(),
}));

vi.mock('../mobile/node_modules/react-native/index.js', () => ({ NativeModules: { NativeWealthFixture: fixture } }));
vi.stubGlobal('__DEV__', true);

const { nativeWealthFixture } = await import('../mobile/src/dev/NativeWealthFixture');
const { localWealthService } = await import('../mobile/src/dev/LocalWealthService');
const { decodeWealthCsvPreview } = await import('../mobile/src/features/wealth/model');

describe('debug Wealth SAF fixture boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fixture.getLaunchScene.mockResolvedValue({ dark: true });
    fixture.pickCsv.mockResolvedValue('record_type,id,date,kind\nevent,e-1,2026-11-01,contribution');
    fixture.saveDocument.mockResolvedValue(true);
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/template')) return new Response('record_type,id,date,kind\n', { status: 200 });
      if (url.endsWith('/export')) return new Response('date,kind\n', { status: 200 });
      if (url.endsWith('/imports/preview')) return new Response(JSON.stringify({ previewId: 'preview-1', revision: 4, rows: [] }), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    }));
  });

  it('times out a stalled CSV upload and permits a retry', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      })));
      const upload = expect(localWealthService.startCsvImport?.('stalled-upload')).rejects.toThrow(/timed out/i);
      await vi.advanceTimersByTimeAsync(15000);
      await upload;
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ previewId: 'retry-preview', revision: 1, rows: [] }), { status: 200 })));
      await expect(localWealthService.startCsvImport?.('stalled-upload')).resolves.toMatchObject({ status: 'completed' });
    } finally { vi.useRealTimers(); }
  });

  it('uses only the debug native module for fixture launch and SAF operations', async () => {
    await expect(nativeWealthFixture.getLaunchScene()).resolves.toEqual({ dark: true });
    await expect(nativeWealthFixture.pickCsv()).resolves.toContain('record_type');
    await expect(nativeWealthFixture.saveDocument('csv', 'fixture.csv')).resolves.toBe(true);
    expect(fixture.pickCsv).toHaveBeenCalledTimes(1);
    expect(fixture.saveDocument).toHaveBeenCalledWith('csv', 'fixture.csv');
  });

  it('round-trips a picked file through the synthetic server preview', async () => {
    const result = await localWealthService.startCsvImport?.('wealth-pick');
    expect(result?.status).toBe('completed');
    expect(await localWealthService.readCsvPreview?.('wealth-pick')).toContain('preview-1');
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'http://127.0.0.1:8794/api/wealth/imports/preview',
      expect.objectContaining({ method: 'POST', body: expect.stringContaining('record_type') }),
    );
  });

  it('requests the CAD reporting currency for the synthetic report and bank-flow reads', async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ householdCashFlows: [], investmentCashFlows: [] }), { status: 200 }));
    await localWealthService.read({ periodStart: '2026-11-01', periodEnd: '2026-11-03' });
    await localWealthService.readBankTransactions?.();
    const urls = vi.mocked(fetch).mock.calls.map(([input]) => new URL(String(input)));
    expect(urls[0].searchParams.get('reportingCurrency')).toBe('CAD');
    expect(urls[0].searchParams.get('from')).toBe('2026-11-01');
    expect(urls[0].searchParams.get('to')).toBe('2026-11-03');
    expect(urls[1].searchParams.get('reportingCurrency')).toBe('CAD');
  });

  it.each([
    { httpStatus: 400, status: 'rejected' },
    { httpStatus: 409, status: 'revision_conflict' },
    { httpStatus: 503, status: 'reconciliation_required' },
  ])('exposes the $status operation receipt from the synthetic transport', async ({ httpStatus, status }) => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: httpStatus }));
    const result = await localWealthService.startWrite(`fixture-${status}`, 'event', '{}');
    expect(result).toMatchObject({ operationId: `fixture-${status}`, status });
  });

  it('retains handler-shaped preview rows and commits exactly those row IDs', async () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({
      rowId: `row-${index + 1}`, rowIndex: index, recordType: 'event',
      record: { recordType: 'event', event: { id: `event-${index + 1}`, sourceId: `source-${index + 1}`, date: '2026-11-01', kind: 'contribution', accountId: 'brokerage' } },
      event: { id: `event-${index + 1}`, sourceId: `source-${index + 1}`, date: '2026-11-01', kind: 'contribution', accountId: 'brokerage' },
      error: null, duplicateOf: null,
    }));
    const preview = { previewId: 'preview-10', revision: 12, sourceHeaders: ['record_type', 'id', 'date', 'kind', 'account_id'], canonicalHeaders: ['record_type', 'id', 'date', 'kind', 'account_id'], mapping: {}, rows, errors: [], duplicates: [] };
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/imports/preview')) return new Response(JSON.stringify(preview), { status: 200 });
      if (url.endsWith('/imports/preview-10/commit')) return new Response(JSON.stringify({ committed: 10 }), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    });
    const result = await localWealthService.startCsvImport?.('wealth-pick-10');
    expect(result?.status).toBe('completed');
    const decoded = decodeWealthCsvPreview(await localWealthService.readCsvPreview?.('wealth-pick-10') ?? '');
    expect(decoded.rowCount).toBe(10);
    expect(decoded.validRowIds).toEqual(rows.map(row => row.rowId));
    const commit = await localWealthService.startWrite('wealth-commit-10', 'csv-commit', JSON.stringify({ previewId: decoded.previewId, expectedRevision: decoded.revision, rowIds: decoded.validRowIds }));
    expect(commit.status).toBe('completed');
    const commitRequest = vi.mocked(fetch).mock.calls.find(([input]) => String(input).endsWith('/imports/preview-10/commit'));
    expect(JSON.parse(String(commitRequest?.[1]?.body))).toMatchObject({ operationId: 'wealth-commit-10', rowIds: rows.map(row => row.rowId) });
  });

});
