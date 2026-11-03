import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const nativeAccessibility = vi.hoisted(() => ({ backHandlers: [] as Array<() => boolean> }));
const require = createRequire(new URL('../mobile/package.json', import.meta.url));
const React = require('react');
const { act, create } = require('react-test-renderer');

vi.mock('../mobile/node_modules/react-native/index.js', () => ({
  Text: 'Text', View: 'View', Pressable: 'Pressable', TextInput: 'TextInput', ActivityIndicator: 'ActivityIndicator', Modal: 'Modal', ScrollView: 'ScrollView',
  AppState: { addEventListener: () => ({ remove() {} }) }, BackHandler: { addEventListener: (_event: string, handler: () => boolean) => { nativeAccessibility.backHandlers.push(handler); return { remove: () => { nativeAccessibility.backHandlers = nativeAccessibility.backHandlers.filter(value => value !== handler); } }; } },
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 }, TurboModuleRegistry: { getEnforcing: () => ({}) },
}));

const { WealthOverview, WealthInvestments, WealthCashFlow } = await import('../mobile/src/features/wealth/WealthViews');
const { decodeWealthCsvPreview, decodeWealthEvents, decodeWealthSnapshot } = await import('../mobile/src/features/wealth/model');
const { WealthScreen, decodeQuoteReceiptError, decodeWealthWriteFailure } = await import('../mobile/src/screens/WealthScreen');

type AccessibilityNode = { props: { accessibilityRole?: unknown; accessibilityLabel?: unknown; accessible?: unknown } };

const data = {
  asOf: '2026-11-02T12:00:00Z', stale: true, missingData: ['VTI price'],
  accounts: [{ id: 'brokerage', name: 'Long view', kind: 'brokerage', mode: 'holdings', currency: 'CAD' }],
  positions: [{ accountId: 'brokerage', instrument: { exchange: 'TSX', ticker: 'SHOP', type: 'stock', currency: 'CAD' }, quantity: '2', costBasisMinor: 18000, basisKnown: true, realizedGainMinor: 1000, valuation: null, marketValueMinor: null, unrealizedGainMinor: null }],
  cash: [{ accountId: 'brokerage', currency: 'CAD', amountMinor: 5000 }], totalByCurrency: { CAD: 5000 }, history: [], cashFlows: [],
  modifiedDietz: { value: null, available: false, reason: 'missing_start_valuation' }, quote: { configured: false, provider: null, lastRefreshedAt: null },
  csv: { template: null, previewId: null, rowCount: 0, errors: [], duplicates: [] },
};

const reactNativeAccessibilityRoles = new Set([
  'none', 'button', 'dropdownlist', 'togglebutton', 'link', 'search', 'image', 'keyboardkey', 'text', 'adjustable',
  'imagebutton', 'header', 'summary', 'alert', 'checkbox', 'combobox', 'menu', 'menubar', 'menuitem', 'progressbar',
  'radio', 'radiogroup', 'scrollbar', 'spinbutton', 'switch', 'tab', 'tabbar', 'tablist', 'timer', 'list', 'toolbar',
  'grid', 'pager', 'scrollview', 'horizontalscrollview', 'viewgroup', 'webview', 'drawerlayout', 'slidingdrawer', 'iconmenu',
]);

describe('Android Wealth views', () => {
  it('shows stale and missing-value explanations instead of zeroes', () => {
    let tree: any;
    act(() => { tree = create(React.createElement(WealthOverview, { dark: false, data, onAction: vi.fn() })); });
    const output = JSON.stringify(tree.toJSON());
    expect(output).toContain('last confirmed');
    expect(output).toContain('Unavailable');
    expect(output).toContain('VTI price');
  });

  it('renders one labeled net-worth chart per original currency', () => {
    let tree: any;
    const multiCurrency = { ...data, history: [{ date: '2026-11-01', totals: { CAD: 5000, USD: 3100 }, complete: true }, { date: '2026-11-02', totals: { CAD: 5100, USD: null }, complete: false }] };
    act(() => { tree = create(React.createElement(WealthOverview, { dark: false, data: multiCurrency, onAction: vi.fn() })); });
    const output = JSON.stringify(tree.toJSON());
    expect(tree.root.findAll((node: AccessibilityNode) => typeof node.props.accessibilityLabel === 'string' && String(node.props.accessibilityLabel).startsWith('CAD net worth history chart · '))).toHaveLength(1);
    expect(tree.root.findAll((node: AccessibilityNode) => typeof node.props.accessibilityLabel === 'string' && String(node.props.accessibilityLabel).startsWith('USD net worth history chart · '))).toHaveLength(1);
    expect(output).toContain('Unavailable');
  });

  it('preserves handler history coverage and labels known subtotals without treating them as full net worth', () => {
    const decoded = decodeWealthSnapshot(JSON.stringify({
      ...data,
      history: [
        { date: '2026-11-01', totals: { CAD: 5000 }, complete: false },
        { date: '2026-11-02', totals: { CAD: 5100 }, complete: true },
      ],
    }));
    expect(decoded.history.map(point => ({ date: point.date, complete: point.complete }))).toEqual([
      { date: '2026-11-01', complete: false },
      { date: '2026-11-02', complete: true },
    ]);
    let tree: any;
    act(() => { tree = create(React.createElement(WealthOverview, { dark: false, data: decoded, onAction: vi.fn() })); });
    const output = JSON.stringify(tree.toJSON());
    expect(output).toContain('Known subtotal');
    expect(output).toContain('Complete observation');
    expect(tree.root.findAllByProps({ accessible: true }).map((node: AccessibilityNode) => String(node.props.accessibilityLabel)).some((label: string) => label.includes('Known subtotal'))).toBe(true);
  });

  it('renders the server CAD estimate with exact dated EUR-base FX provenance', () => {
    const decoded = decodeWealthSnapshot(JSON.stringify({
      ...data,
      asOf: '2026-11-02T12:00:00Z',
      totalByCurrency: { EUR: 10000 },
      fx: { convertedCadMinor: 14800, complete: true, unavailable: [], effectiveDate: '2026-11-02', provider: 'frankfurter', baseCurrency: 'EUR', rates: { CAD: '1.48' } },
    }));
    expect(decoded.fx).toEqual({ convertedCadMinor: 14800, complete: true, unavailable: [], effectiveDate: '2026-11-02', provider: 'frankfurter', baseCurrency: 'EUR', rates: { CAD: '1.48' } });
    let tree: any;
    act(() => { tree = create(React.createElement(WealthOverview, { dark: false, data: decoded, onAction: vi.fn() })); });
    const output = JSON.stringify(tree.toJSON());
    expect(output).toContain('CAD 148.00');
    expect(output).toContain('frankfurter · EUR base · effective 2026-11-02 · EUR → CAD 1.48');
  });

  it('keeps an earlier provider effective date explicit instead of presenting it as the report date', () => {
    const decoded = decodeWealthSnapshot(JSON.stringify({
      ...data,
      asOf: '2026-11-03T12:00:00Z',
      totalByCurrency: { EUR: 10000 },
      fx: { convertedCadMinor: 14700, complete: true, unavailable: [], effectiveDate: '2026-11-02', provider: 'frankfurter', baseCurrency: 'EUR', rates: { CAD: '1.47' } },
    }));
    let tree: any;
    act(() => { tree = create(React.createElement(WealthOverview, { dark: false, data: decoded, onAction: vi.fn() })); });
    const output = JSON.stringify(tree.toJSON());
    expect(output).toContain('effective 2026-11-02');
    expect(output).toContain('provider date precedes report date');
  });

  it('does not invent FX provenance or a zero estimate when metadata is missing', () => {
    const decoded = decodeWealthSnapshot(JSON.stringify({
      ...data,
      totalByCurrency: { EUR: 10000 },
      fx: { convertedCadMinor: null, complete: false, unavailable: ['EUR'], effectiveDate: null, provider: null, baseCurrency: null, rates: {} },
    }));
    let tree: any;
    act(() => { tree = create(React.createElement(WealthOverview, { dark: false, data: decoded, onAction: vi.fn() })); });
    const output = JSON.stringify(tree.toJSON());
    expect(output).toContain('CAD estimate unavailable');
    expect(output).toContain('FX source details unavailable');
    expect(output).not.toContain('CAD 0.00');
  });

  it('exposes a text alternative for history and labeled investment actions', () => {
    let tree: any;
    act(() => { tree = create(React.createElement(WealthInvestments, { dark: true, data, onAction: vi.fn() })); });
    expect(JSON.stringify(tree.toJSON())).toContain('No dated prices');
    expect(tree.root.findAllByProps({ accessibilityRole: 'button' }).length).toBeGreaterThan(0);
  });

  it('opens the typed valuation editor when an overview action targets investments', () => {
    let tree: any;
    act(() => { tree = create(React.createElement(WealthInvestments, { dark: false, data, operation: 'valuation', onAction: vi.fn() })); });
    expect(JSON.stringify(tree.toJSON())).toContain('Dated balance or price');
    expect(JSON.stringify(tree.toJSON())).not.toContain('Raw JSON');
  });

  it('uses the dedicated event history when the report omits event rows', () => {
    let tree: any;
    const dataWithoutEvents = { ...data, events: undefined };
    act(() => { tree = create(React.createElement(WealthInvestments, {
      dark: false,
      data: dataWithoutEvents,
      events: [{ id: 'event-1', sourceId: 'source-1', date: '2026-10-01', kind: 'contribution', label: 'Salary contribution', accountId: 'brokerage' }],
      operation: 'correction',
      onAction: vi.fn(),
    })); });
    expect(JSON.stringify(tree.toJSON())).toContain('Salary contribution');
  });

  it('announces an activated account detail and closes it with Android Back', async () => {
    nativeAccessibility.backHandlers.length = 0;
    const service = {
      read: vi.fn(async () => JSON.stringify(data)),
      readEvents: vi.fn(async () => JSON.stringify({ events: [{ id: 'event-1', sourceId: 'source-1', date: '2026-11-01', kind: 'contribution', accountId: 'brokerage', memo: 'Opening contribution' }] })),
      readValuations: vi.fn(async () => JSON.stringify({ valuations: [{ id: 'valuation-1', accountId: 'brokerage', instrument: null, asOf: '2026-11-01', priceMinor: 5000, source: 'manual', provider: null }] })),
      startWrite: vi.fn(async (operationId: string, action: string) => ({ operationId, kind: action, status: 'completed', updatedAt: 'now', resultId: null })),
      onChanged: () => ({ remove() {} }),
    };
    let tree: any;
    await act(async () => { tree = create(React.createElement(WealthScreen, { dark: false, service })); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { tree.root.findByProps({ accessibilityLabel: 'Investments' }).props.onPress(); await Promise.resolve(); });
    await act(async () => { tree.root.findByProps({ accessibilityLabel: 'Open Long view' }).props.onPress(); await Promise.resolve(); await Promise.resolve(); });
    expect(JSON.stringify(tree.toJSON())).toContain('Selected Wealth detail');
    expect(JSON.stringify(tree.toJSON())).toContain('Long view');
    expect(JSON.stringify(tree.toJSON())).toContain('1 server events in this account.');
    const backHandler = nativeAccessibility.backHandlers[nativeAccessibility.backHandlers.length - 1];
    expect(backHandler?.()).toBe(true);
    await act(async () => { await Promise.resolve(); });
    expect(JSON.stringify(tree.toJSON())).not.toContain('Selected Wealth detail');
  });

  it('only registers detail Back handling while the shell is focused and clears detail on blur', async () => {
    nativeAccessibility.backHandlers.length = 0;
    const service = {
      read: vi.fn(async () => JSON.stringify(data)),
      readEvents: vi.fn(async () => JSON.stringify({ events: [] })),
      readValuations: vi.fn(async () => JSON.stringify({ valuations: [] })),
      startWrite: vi.fn(async (operationId: string, action: string) => ({ operationId, kind: action, status: 'completed', updatedAt: 'now', resultId: null })),
      onChanged: () => ({ remove() {} }),
    };
    let tree: any;
    await act(async () => { tree = create(React.createElement(WealthScreen, { dark: false, service, isFocused: true })); await Promise.resolve(); await Promise.resolve(); });
    expect(nativeAccessibility.backHandlers).toHaveLength(1);
    await act(async () => { tree.root.findByProps({ accessibilityLabel: 'Investments' }).props.onPress(); await Promise.resolve(); });
    await act(async () => { tree.root.findByProps({ accessibilityLabel: 'Open Long view' }).props.onPress(); await Promise.resolve(); await Promise.resolve(); });
    expect(JSON.stringify(tree.toJSON())).toContain('Selected Wealth detail');
    await act(async () => { tree.update(React.createElement(WealthScreen, { dark: false, service, isFocused: false })); await Promise.resolve(); });
    expect(nativeAccessibility.backHandlers).toHaveLength(0);
    expect(JSON.stringify(tree.toJSON())).not.toContain('Selected Wealth detail');
    await act(async () => { tree.update(React.createElement(WealthScreen, { dark: false, service, isFocused: true })); await Promise.resolve(); });
    expect(nativeAccessibility.backHandlers).toHaveLength(1);
    expect(nativeAccessibility.backHandlers[0]()).toBe(false);
  });

  it('labels ambiguous cash flows and keeps missing performance unavailable', () => {
    let tree: any;
    act(() => { tree = create(React.createElement(WealthCashFlow, { dark: false, data, onAction: vi.fn() })); });
    expect(JSON.stringify(tree.toJSON())).toContain('Performance unavailable');
    expect(JSON.stringify(tree.toJSON())).toContain('No cash flows');
  });

  it('renders server-calculated performance independently for each original currency', () => {
    let tree: any;
    const byCurrency = { ...data, modifiedDietzByCurrency: { CAD: { value: 0.12, available: true, reason: null }, USD: { value: null, available: false, reason: 'missing_end_valuation' } } };
    act(() => { tree = create(React.createElement(WealthCashFlow, { dark: false, data: byCurrency, onAction: vi.fn() })); });
    const output = JSON.stringify(tree.toJSON());
    expect(output).toContain('Performance by currency');
    expect(output).toContain('CAD');
    expect(output).toContain('USD');
    expect(output).toContain('12.00%');
    expect(output).toContain('Performance unavailable');
  });

  it('renders authoritative allocation rows without converting unavailable values to zero', () => {
    let tree: any;
    const allocated = {
      ...data,
      allocations: [
        { currency: 'CAD', accountId: 'brokerage', kind: 'cash', instrument: null, valueMinor: 5000, share: 0.25, available: true },
        { currency: 'CAD', accountId: 'brokerage', kind: 'holding', instrument: { exchange: 'TSX', ticker: 'SHOP', type: 'stock', currency: 'CAD' }, valueMinor: null, share: null, available: false },
      ],
    };
    act(() => { tree = create(React.createElement(WealthInvestments, { dark: false, data: allocated, onAction: vi.fn() })); });
    const output = JSON.stringify(tree.toJSON());
    expect(output).toContain('Allocation by original currency');
    expect(output).toContain('25.00%');
    expect(output).toContain('Allocation unavailable');
    expect(output).not.toContain('CAD 0.00');
  });

  it('uses Android-safe roles while keeping list rows individually labelled for TalkBack', () => {
    const rowData = {
      ...data,
      history: [{ date: '2026-11-01', totals: { CAD: 5000 }, complete: true }],
      cashFlows: [{ sourceId: 'flow-1', date: '2026-11-01', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 500 }, classification: 'external_contribution', includedInPerformance: true, reason: 'Linked contribution' }],
      allocations: [{ currency: 'CAD', accountId: 'brokerage', kind: 'aggregate', instrument: null, valueMinor: 9000, share: 1, available: true }],
    };
    let overviewTree: any;
    let investmentsTree: any;
    let cashFlowTree: any;
    act(() => { overviewTree = create(React.createElement(WealthOverview, { dark: false, data: rowData, onAction: vi.fn() })); });
    act(() => { investmentsTree = create(React.createElement(WealthInvestments, { dark: false, data: rowData, onAction: vi.fn() })); });
    act(() => { cashFlowTree = create(React.createElement(WealthCashFlow, { dark: false, data: rowData, onAction: vi.fn() })); });
    const trees = [overviewTree, investmentsTree, cashFlowTree];
    const roles = trees.flatMap((tree: any) => tree.root.findAll((node: AccessibilityNode) => typeof node.props.accessibilityRole === 'string').map((node: AccessibilityNode) => node.props.accessibilityRole as string));
    expect(roles).not.toContain('table');
    expect(roles).not.toContain('row');
    roles.forEach(role => expect(reactNativeAccessibilityRoles.has(role)).toBe(true));
    expect(trees[0].root.findByProps({ accessibilityLabel: 'Net worth history list' })).toBeTruthy();
    expect(trees[1].root.findByProps({ accessibilityLabel: 'Wealth allocation by original currency' })).toBeTruthy();
    expect(trees[2].root.findByProps({ accessibilityLabel: 'Household cash flow list' })).toBeTruthy();
    expect(trees[0].root.findAllByProps({ accessible: true }).map((node: AccessibilityNode) => String(node.props.accessibilityLabel))).toContain('2026-11-01 · Complete observation · CAD 50.00');
  });

  it('keeps aggregate allocations and transfer/correction event provenance from the server report', () => {
    const decoded = decodeWealthSnapshot(JSON.stringify({
      ...data,
      allocations: [{ currency: 'CAD', accountId: 'brokerage', kind: 'aggregate', instrument: null, valueMinor: 9000, share: 1, available: true }],
      events: [{ id: 'transfer-1', sourceId: 'transfer-source', date: '2026-11-01', kind: 'transfer', fromAccountId: 'brokerage', toAccountId: 'other', transferKind: 'cash', linkedBankSourceId: null }, {
        id: 'correction-1', sourceId: 'correction-source', date: '2026-11-02', kind: 'correction', replacement: { accountId: 'brokerage', linkedBankSourceId: 'bank-source', kind: 'contribution' },
      }],
    }));
    expect(decoded.allocations).toHaveLength(1);
    expect(decoded.allocations?.[0]).toMatchObject({ kind: 'aggregate', valueMinor: 9000 });
    expect(decoded.events).toMatchObject([
      { accountId: 'brokerage', linkedBankSourceId: null },
      { accountId: 'brokerage', linkedBankSourceId: 'bank-source' },
    ]);
    expect(decodeWealthEvents(JSON.stringify({ events: [{ id: 'transfer-1', sourceId: 'transfer-source', date: '2026-11-01', kind: 'transfer', fromAccountId: 'brokerage', toAccountId: 'other' }] }))).toMatchObject([{ accountId: 'brokerage' }]);
  });

  it('normalizes authoritative investment cash-flow lanes, metadata, totals, and linked-bank deduplication', () => {
    const decoded = decodeWealthSnapshot(JSON.stringify({
      ...data,
      allocations: [{ currency: 'CAD', accountId: 'brokerage', kind: 'aggregate', instrument: null, valueMinor: 9000, share: 1, available: true }],
      householdCashFlows: [{
        sourceId: 'bank-dividend', date: '2026-11-01', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 300 },
        direction: 'inflow', kind: 'bank', classification: 'ambiguous', includedInPerformance: false, reason: 'Linked investment income',
        transactionId: 'tx-dividend', merchant: 'Brokerage sweep', accountName: 'Questrade', category: 'Dividend', bankKind: 'income',
        eventKind: 'dividend', linkedWealthSourceId: 'wealth-dividend', source: 'bank', status: 'confirmed', linkConflict: false, confirmed: true,
      }],
      investmentCashFlows: [
        {
          sourceId: 'bank-dividend', date: '2026-11-01', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 300 },
          direction: 'inflow', kind: 'bank', classification: 'ambiguous', includedInPerformance: false, reason: 'Linked investment income',
          transactionId: 'tx-dividend', merchant: 'Brokerage sweep', accountName: 'Questrade', category: 'Dividend', bankKind: 'income',
          eventKind: 'dividend', source: 'bank', status: 'confirmed', linkConflict: false, confirmed: true,
        },
        {
          sourceId: 'bank-dividend', date: '2026-11-01', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 300 },
          direction: 'inflow', kind: 'bank', classification: 'ambiguous', includedInPerformance: false, reason: 'Linked investment income',
          transactionId: 'tx-dividend', merchant: 'Brokerage sweep', accountName: 'Questrade', category: 'Dividend', bankKind: 'income',
          eventKind: 'dividend', source: 'bank', status: 'confirmed', linkConflict: false, confirmed: true,
        },
        {
          sourceId: 'wealth-fee', date: '2026-11-02', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 25 },
          direction: 'outflow', kind: 'fee', classification: 'trade', includedInPerformance: false, reason: 'Recorded investment fee',
          eventKind: 'fee', source: 'wealth', status: 'confirmed', confirmed: true,
        },
        {
          sourceId: 'wealth-withholding', date: '2026-11-02', accountId: 'brokerage', money: { currency: 'CAD', amountMinor: 10 },
          direction: 'outflow', kind: 'withdrawal', classification: 'trade', includedInPerformance: false, reason: 'Recorded withholding',
          eventKind: 'withholding', source: 'wealth', status: 'confirmed', confirmed: true,
        },
      ],
      investmentCashFlowTotals: { CAD: { inflowMinor: 300, outflowMinor: 35, netMinor: 265, incomeMinor: 300, expenseMinor: 35, refundMinor: 0, feeMinor: 25 } },
    }));
    expect(decoded.allocations?.[0]).toMatchObject({ kind: 'aggregate' });
    expect(decoded.householdCashFlows).toHaveLength(1);
    expect(decoded.investmentCashFlows).toHaveLength(3);
    expect(decoded.investmentCashFlows?.[0]).toMatchObject({ eventKind: 'dividend', transactionId: 'tx-dividend', merchant: 'Brokerage sweep', confirmed: true });
    expect(decoded.investmentCashFlows?.[1]).toMatchObject({ eventKind: 'fee' });
    expect(decoded.investmentCashFlows?.[2]).toMatchObject({ eventKind: 'withholding' });
    expect(decoded.investmentCashFlowTotals?.CAD).toMatchObject({ incomeMinor: 300, expenseMinor: 35, feeMinor: 25 });

    let tree: any;
    act(() => { tree = create(React.createElement(WealthCashFlow, { dark: false, data: decoded, onAction: vi.fn() })); });
    const output = JSON.stringify(tree.toJSON());
    expect(output).toContain('Investment income and expenses');
    expect(output).toContain('Brokerage sweep');
    expect(output).toContain('Linked bank record');
    expect(output).toContain('Fee');
    expect(output).toContain('Withholding');
    expect(output).toContain('CAD 3.00');
  });

  it('shows quote-provider failures without mislabeling a successful refresh', () => {
    expect(decodeQuoteReceiptError(JSON.stringify({ status: 'refreshed' }))).toBeNull();
    expect(decodeQuoteReceiptError(JSON.stringify({ status: 'provider_error', reason: 'Provider unavailable.' }))).toBe('Provider unavailable.');
  });

  it('keeps an account guard reason in the accessible write error copy', () => {
    expect(decodeWealthWriteFailure(JSON.stringify({ code: 'account_mode_conflict', reason: 'Only brokerage accounts support holdings plus cash representation.' }), 'rejected')).toBe('Only brokerage accounts support holdings plus cash representation.');
  });

  it('forwards injected CSV capabilities so the visible picker and template controls complete', async () => {
    const operation = (operationId: string, kind: string) => ({ operationId, kind, status: 'completed', updatedAt: 'now', resultId: null });
    const service = {
      read: vi.fn(async () => JSON.stringify(data)),
      startWrite: vi.fn(async (operationId: string, action: string) => operation(operationId, action)),
      startCsvImport: vi.fn(async (operationId: string) => operation(operationId, 'wealth_csv-preview')),
      startCsvTemplate: vi.fn(async (operationId: string) => operation(operationId, 'wealth_csv-template')),
      readCsvPreview: vi.fn(async (operationId: string) => JSON.stringify({ previewId: operationId, rowCount: 0, errors: [], duplicates: [] })),
      onChanged: () => ({ remove() {} }),
    };
    let tree: any;
    await act(async () => { tree = create(React.createElement(WealthScreen, { dark: false, service })); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { tree.root.findByProps({ accessibilityLabel: 'Investments' }).props.onPress(); await Promise.resolve(); });
    await act(async () => { tree.root.findByProps({ accessibilityLabel: 'Preview CSV' }).props.onPress(); await Promise.resolve(); });
    await act(async () => { tree.root.findByProps({ accessibilityLabel: 'Choose Wealth CSV file' }).props.onPress(); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { tree.root.findByProps({ accessibilityLabel: 'Save Wealth CSV template' }).props.onPress(); await Promise.resolve(); });
    expect(service.startCsvImport).toHaveBeenCalledTimes(1);
    expect(service.readCsvPreview).toHaveBeenCalledWith(expect.any(String));
    expect(service.startCsvTemplate).toHaveBeenCalledTimes(1);
  });

  it('keeps a server preview reachable for commit before optional mapping', async () => {
    const operation = (operationId: string, kind: string) => ({ operationId, kind, status: 'completed', updatedAt: 'now', resultId: null });
    const previewRows = Array.from({ length: 10 }, (_, index) => ({
      rowId: `row-${index + 1}`, rowIndex: index, recordType: 'event',
      record: { recordType: 'event', event: { id: `event-${index + 1}`, sourceId: `source-${index + 1}`, date: '2026-11-01', kind: 'contribution', accountId: 'brokerage' } },
      event: { id: `event-${index + 1}`, sourceId: `source-${index + 1}`, date: '2026-11-01', kind: 'contribution', accountId: 'brokerage' },
      error: null, duplicateOf: null,
    }));
    const preview = {
      previewId: 'preview-10', revision: 8, sourceHeaders: ['record_type', 'id', 'date', 'kind', 'account_id'],
      canonicalHeaders: ['record_type', 'id', 'date', 'kind', 'account_id'], mapping: {}, rows: previewRows, errors: [], duplicates: [],
    };
    const startWrite = vi.fn(async (operationId: string, action: string, _body: string) => operation(operationId, action));
    const service = {
      read: vi.fn(async () => JSON.stringify(data)),
      startWrite,
      startCsvImport: vi.fn(async (operationId: string) => operation(operationId, 'wealth_csv-preview')),
      readCsvPreview: vi.fn(async () => JSON.stringify(preview)),
      onChanged: () => ({ remove() {} }),
    };
    let tree: any;
    await act(async () => { tree = create(React.createElement(WealthScreen, { dark: false, service })); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { tree.root.findByProps({ accessibilityLabel: 'Investments' }).props.onPress(); await Promise.resolve(); });
    await act(async () => { tree.root.findByProps({ accessibilityLabel: 'Preview CSV' }).props.onPress(); await Promise.resolve(); });
    await act(async () => { tree.root.findByProps({ accessibilityLabel: 'Choose Wealth CSV file' }).props.onPress(); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { tree.root.findByProps({ accessibilityLabel: 'Commit CSV' }).props.onPress(); await Promise.resolve(); });
    expect(JSON.stringify(tree.toJSON())).toContain('10 rows ready to commit · 10 staged');
    expect(tree.root.findByProps({ accessibilityLabel: 'Show CSV column mapping' })).toBeTruthy();
    expect(tree.root.findAllByProps({ accessibilityRole: 'button' }).length).toBeLessThan(100);
    await act(async () => { tree.root.findByProps({ accessibilityLabel: 'Commit previewed Wealth CSV' }).props.onPress(); await Promise.resolve(); });
    const commitCall = startWrite.mock.calls.find(([, action]) => action === 'csv-commit');
    expect(commitCall).toBeTruthy();
    expect(JSON.parse(String(commitCall?.[2]))).toEqual({ previewId: 'preview-10', expectedRevision: 8, rowIds: previewRows.map(row => row.rowId) });
  });

  it('keeps custom mapping compact and re-previews one selected field', () => {
    const onRemap = vi.fn();
    const csv = {
      ...data.csv, previewId: 'preview-map', revision: 9, sourceHeaders: ['trade date', 'type', 'acct'],
      canonicalHeaders: ['date', 'kind', 'account_id'], mapping: {}, validRowIds: ['row-1'], rowCount: 1,
      previewRows: [{ rowId: 'row-1', rowIndex: 0, recordType: 'event', record: null, event: null, date: '2026-11-01', kind: 'contribution', accountId: 'brokerage', details: null, error: null, duplicateOf: null }],
    };
    let tree: any;
    act(() => { tree = create(React.createElement(WealthInvestments, { dark: false, data, csv, csvSourceOperationId: 'source-1', onCsvRemap: onRemap, operation: 'csv-commit', onAction: vi.fn() })); });
    expect(tree.root.findAllByProps({ accessibilityRole: 'button' }).length).toBeLessThan(100);
    act(() => { tree.root.findByProps({ accessibilityLabel: 'Show CSV column mapping' }).props.onPress(); });
    act(() => { tree.root.findByProps({ accessibilityLabel: 'Choose source column for date' }).props.onPress(); });
    act(() => { tree.root.findByType('Modal').props.onRequestClose(); });
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Close source column picker' })).toHaveLength(0);
    act(() => { tree.root.findByProps({ accessibilityLabel: 'Choose source column for date' }).props.onPress(); });
    act(() => { tree.root.findByProps({ accessibilityLabel: 'trade date for date' }).props.onPress(); });
    expect(JSON.stringify(tree.toJSON())).toContain('trade date');
    act(() => { tree.root.findByProps({ accessibilityLabel: 'Re-preview mapped CSV' }).props.onPress(); });
    expect(onRemap).toHaveBeenCalledWith(expect.objectContaining({ date: 'trade date' }));
  });

  it('keeps mode-transition CSV preview rows addressable with human details', () => {
    const decoded = decodeWealthCsvPreview(JSON.stringify({
      previewId: 'preview-transition', revision: 12, errors: [], duplicates: [],
      rows: [{
        rowId: 'transition-row-1', rowIndex: 0, recordType: 'mode_transition',
        record: { recordType: 'mode_transition', transition: { id: 'transition-1', accountId: 'brokerage', effectiveDate: '2026-11-01', fromMode: 'aggregate', toMode: 'holdings', openingCashMinor: 1000, openingPositions: [] } },
        event: null, error: null, duplicateOf: null,
      }],
    }));
    expect(decoded.validRowIds).toEqual(['transition-row-1']);
    expect(decoded.previewRows).toEqual([expect.objectContaining({ rowId: 'transition-row-1', recordType: 'mode_transition', date: '2026-11-01', accountId: 'brokerage', details: 'Account brokerage · aggregate → holdings · effective 2026-11-01 · opening cash' })]);
    expect(decoded.previewRows?.[0].record).toMatchObject({ recordType: 'mode_transition', transition: { id: 'transition-1', fromMode: 'aggregate', toMode: 'holdings' } });
  });
});
