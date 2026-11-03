import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../mobile/package.json', import.meta.url));
const React = require('react');
const { act, create } = require('react-test-renderer');

vi.mock('../mobile/node_modules/react-native/index.js', () => ({
  Text: 'Text', View: 'View', Pressable: 'Pressable', TextInput: 'TextInput', ActivityIndicator: 'ActivityIndicator', Modal: 'Modal', ScrollView: 'ScrollView',
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
  TurboModuleRegistry: { getEnforcing: () => ({}) },
}));

const { InvestmentOperations } = await import('../mobile/src/features/wealth/WealthViews');
const { DraftOperationIdentityRegistry, safeEventPayload } = await import('../mobile/src/screens/WealthScreen');

type WriteCall = { operationId: string; action: string; body: string };
function makeWrite() {
  return vi.fn(async ({ operationId, action, body }: WriteCall) => ({ operationId, kind: action, status: 'completed', updatedAt: '', resultId: null, body }));
}

function contributionEditor(onAction: (action: string, body?: string) => void) {
  const data = {
    accounts: [{ id: 'brokerage', name: 'Maple brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD' }],
    instruments: [], events: [], bankTransactions: [], quote: { configured: false, provider: null, lastRefreshedAt: null },
    csv: { template: null, previewId: null, rowCount: 0, errors: [], duplicates: [] },
  };
  let tree: any;
  act(() => { tree = create(React.createElement(InvestmentOperations, { dark: false, ...data, initialAction: 'event', onAction })); });
  const choose = (label: string) => act(() => { tree.root.findAllByProps({ accessibilityLabel: label }).at(-1).props.onPress(); });
  const fill = (label: string, value: string) => act(() => { tree.root.findByProps({ accessibilityLabel: label }).props.onChangeText(value); });
  choose('Use Maple brokerage');
  choose('contribution');
  return { tree, fill };
}

function accountEditor(data: Record<string, unknown>, onAction: (action: string, body?: string) => void) {
  let tree: any;
  act(() => { tree = create(React.createElement(InvestmentOperations, { dark: false, ...data, initialAction: 'account', onAction })); });
  const choose = (label: string) => act(() => { tree.root.findAllByProps({ accessibilityLabel: label }).at(-1).props.onPress(); });
  const fill = (label: string, value: string) => act(() => { tree.root.findByProps({ accessibilityLabel: label }).props.onChangeText(value); });
  return { tree, choose, fill };
}

function saveAccountTransition(mode: 'aggregate' | 'holdings', targetLabel: string, date: string, valueLabel: string, value: string) {
  const startWrite = vi.fn();
  const { tree, choose, fill } = accountEditor({
    accounts: [{ id: 'brokerage', name: 'Maple brokerage', kind: 'brokerage', mode, currency: 'CAD' }],
    instruments: [], events: [], bankTransactions: [],
    quote: { configured: false, provider: null, lastRefreshedAt: null },
    csv: { template: null, previewId: null, rowCount: 0, errors: [], duplicates: [] },
  }, (action, body) => startWrite(action, body));
  chooseAccountAndFill({ choose, fill, targetLabel, date, valueLabel, value });
  const save = tree.root.findAllByProps({ accessibilityLabel: 'Save account' }).at(-1);
  act(() => { save.props.onPress(); });
  return { startWrite, payload: JSON.parse(startWrite.mock.calls[0][1]) as Record<string, unknown>, save };
}

function chooseAccountAndFill({ choose, fill, targetLabel, date, valueLabel, value }: { choose: (label: string) => void; fill: (label: string, value: string) => void; targetLabel: string; date: string; valueLabel: string; value: string }) {
  choose('Use Maple brokerage');
  choose(targetLabel);
  fill('Effective date (YYYY-MM-DD)', date);
  fill(valueLabel, value);
}

describe('Android Wealth typed write flow', () => {
  it('submits a generated account identity through the injected service action', () => {
    const startWrite = makeWrite();
    const data = { accounts: [], instruments: [], events: [], quote: { configured: false, provider: null, lastRefreshedAt: null }, csv: { template: null, previewId: null, rowCount: 0, errors: [], duplicates: [] } };
    let tree: any;
    act(() => { tree = create(React.createElement(InvestmentOperations, { dark: false, ...data, onAction: (action: string, body?: string) => { void startWrite({ operationId: 'op-account', action, body: body ?? '{}' }); } })); });
    const accountName = tree.root.findByProps({ accessibilityLabel: 'Account name' });
    act(() => { accountName.props.onChangeText('Maple brokerage'); });
    const saves = tree.root.findAllByProps({ accessibilityLabel: 'Save account' });
    act(() => { saves.at(-1).props.onPress(); });
    act(() => { saves.at(-1).props.onPress(); });
    expect(startWrite).toHaveBeenCalledWith({ operationId: 'op-account', action: 'account', body: expect.any(String) });
    expect(JSON.parse(startWrite.mock.calls[0][0].body)).toMatchObject({ name: 'Maple brokerage', kind: 'brokerage', mode: 'holdings' });
    const firstId = JSON.parse(startWrite.mock.calls[0][0].body).id as string;
    expect(firstId).toMatch(/^maple-brokerage-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(JSON.parse(startWrite.mock.calls[1][0].body).id).toBe(firstId);
  });

  it('submits an aggregate-to-holdings account transition atomically', () => {
    const { startWrite, payload, save } = saveAccountTransition('aggregate', 'Holdings (securities + cash)', '2026-11-01', 'Opening cash (for example 1250.00)', '1250.00');
    expect(save.props.accessibilityState.disabled).toBe(false);
    expect(startWrite).toHaveBeenCalledTimes(1);
    expect(startWrite.mock.calls[0][0]).toBe('account');
    expect(payload).toMatchObject({ id: 'brokerage', mode: 'holdings', effectiveDate: '2026-11-01', openingCashMinor: 125000, amountMinor: null });
    expect(payload).not.toHaveProperty('openingValueMinor');
  });

  it('submits a canonical opening position when cash is not supplied', () => {
    const startWrite = vi.fn();
    const { tree, choose, fill } = accountEditor({
      accounts: [{ id: 'brokerage', name: 'Maple brokerage', kind: 'brokerage', mode: 'aggregate', currency: 'CAD' }],
      instruments: [{ exchange: 'TSX', ticker: 'SHOP', type: 'stock', currency: 'CAD' }], events: [], bankTransactions: [],
      quote: { configured: false, provider: null, lastRefreshedAt: null },
      csv: { template: null, previewId: null, rowCount: 0, errors: [], duplicates: [] },
    }, (action, body) => startWrite(action, body));
    choose('Use Maple brokerage');
    choose('Holdings (securities + cash)');
    fill('Effective date (YYYY-MM-DD)', '2026-11-01');
    choose('TSX:SHOP · stock · CAD');
    fill('Opening quantity', '3');
    const save = tree.root.findAllByProps({ accessibilityLabel: 'Save account' }).at(-1);
    expect(save.props.accessibilityState.disabled).toBe(false);
    act(() => { save.props.onPress(); });
    const payload = JSON.parse(startWrite.mock.calls[0][1]);
    expect(payload).toMatchObject({ mode: 'holdings', effectiveDate: '2026-11-01', openingPositions: [{ instrument: { exchange: 'TSX', ticker: 'SHOP', type: 'stock', currency: 'CAD' }, quantity: '3' }] });
    expect(payload).not.toHaveProperty('openingCashMinor');
  });

  it('submits a holdings-to-aggregate account transition atomically', () => {
    const { startWrite, payload, save } = saveAccountTransition('holdings', 'Aggregate (one dated value)', '2026-11-02', 'Opening aggregate value (for example 1250.00)', '980.00');
    expect(save.props.accessibilityState.disabled).toBe(false);
    expect(startWrite).toHaveBeenCalledTimes(1);
    expect(payload).toMatchObject({ id: 'brokerage', mode: 'aggregate', effectiveDate: '2026-11-02', openingValueMinor: 98000, amountMinor: null });
    expect(payload).not.toHaveProperty('openingCashMinor');
    expect(payload).not.toHaveProperty('openingPositions');
  });

  it('keeps a mode transition disabled until its effective date and opening state are valid', () => {
    const startWrite = vi.fn();
    const { tree, choose, fill } = accountEditor({
      accounts: [{ id: 'brokerage', name: 'Maple brokerage', kind: 'brokerage', mode: 'aggregate', currency: 'CAD' }],
      instruments: [], events: [], bankTransactions: [],
      quote: { configured: false, provider: null, lastRefreshedAt: null },
      csv: { template: null, previewId: null, rowCount: 0, errors: [], duplicates: [] },
    }, (action, body) => startWrite(action, body));
    choose('Use Maple brokerage');
    choose('Holdings (securities + cash)');
    fill('Effective date (YYYY-MM-DD)', '2026-02-30');
    let save = tree.root.findAllByProps({ accessibilityLabel: 'Save account' }).at(-1);
    expect(save.props.accessibilityState.disabled).toBe(true);
    fill('Effective date (YYYY-MM-DD)', '2026-11-01');
    save = tree.root.findAllByProps({ accessibilityLabel: 'Save account' }).at(-1);
    expect(save.props.accessibilityState.disabled).toBe(true);
    fill('Opening cash (for example 1250.00)', '-125.00');
    save = tree.root.findAllByProps({ accessibilityLabel: 'Save account' }).at(-1);
    expect(save.props.accessibilityState.disabled).toBe(true);
    fill('Opening cash (for example 1250.00)', '125.00');
    save = tree.root.findAllByProps({ accessibilityLabel: 'Save account' }).at(-1);
    expect(save.props.accessibilityState.disabled).toBe(false);
  });

  it('keeps manual assets, debts, and linked bank accounts aggregate-only', () => {
    const startWrite = vi.fn();
    const { tree, choose } = accountEditor({ accounts: [], instruments: [], events: [], bankTransactions: [], quote: { configured: false, provider: null, lastRefreshedAt: null }, csv: { template: null, previewId: null, rowCount: 0, errors: [], duplicates: [] } }, (action, body) => startWrite(action, body));
    choose('manual asset');
    const holdings = tree.root.findByProps({ accessibilityLabel: 'Holdings (securities + cash)' });
    expect(holdings.props.accessibilityState.disabled).toBe(true);
    const save = tree.root.findAllByProps({ accessibilityLabel: 'Save account' }).at(-1);
    act(() => { save.props.onPress(); });
    expect(JSON.parse(startWrite.mock.calls[0][1])).toMatchObject({ kind: 'manual_asset', mode: 'aggregate' });
  });

  it('links a typed wealth event to a human-readable bank record without exposing its id', () => {
    const startWrite = makeWrite();
    const data = {
      accounts: [{ id: 'brokerage', name: 'Maple brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD' }],
      instruments: [], events: [], quote: { configured: false, provider: null, lastRefreshedAt: null },
      csv: { template: null, previewId: null, rowCount: 0, errors: [], duplicates: [] },
      bankTransactions: [{ id: 'tx-internal-only', occurredAt: '2026-11-01', currency: 'CAD', signedMinorUnits: '12500', merchant: 'Brokerage transfer', accountLabel: 'Everyday chequing', status: 'confirmed', sourceLabel: 'manual', category: 'Transfer', note: null, kind: 'income', revision: 3, accountId: 'bank' }],
    };
    let tree: any;
    act(() => { tree = create(React.createElement(InvestmentOperations, { dark: false, ...data, initialAction: 'event', onAction: (action: string, body?: string) => { void startWrite({ operationId: 'op-event', action, body: body ?? '{}' }); } })); });
    const choose = (label: string) => act(() => { tree.root.findAllByProps({ accessibilityLabel: label }).at(-1).props.onPress(); });
    const fill = (label: string, value: string) => act(() => { tree.root.findByProps({ accessibilityLabel: label }).props.onChangeText(value); });
    choose('Use Maple brokerage');
    choose('contribution');
    fill('Event date (YYYY-MM-DD)', '2026-11-01');
    fill('Amount (for example 125.00)', '125.00');
    choose('2026-11-01 · Brokerage transfer · Everyday chequing · CAD 125.00');
    choose('Save event');
    expect(startWrite).toHaveBeenCalledWith({ operationId: 'op-event', action: 'event', body: expect.any(String) });
    expect(JSON.parse(startWrite.mock.calls[0][0].body)).toMatchObject({ kind: 'contribution', accountId: 'brokerage', linkedBankSourceId: 'tx-internal-only' });
    expect(JSON.stringify(tree.toJSON())).not.toContain('tx-internal-only');
  });

  it('preserves an existing bank link when a correction is typed without the raw id', () => {
    const startWrite = makeWrite();
    const data = {
      accounts: [{ id: 'brokerage', name: 'Maple brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD' }],
      instruments: [], bankTransactions: [],
      events: [{ id: 'event-1', sourceId: 'source-1', date: '2026-10-01', kind: 'contribution', label: 'Existing contribution', accountId: 'brokerage', linkedBankSourceId: 'tx-internal-only' }],
      quote: { configured: false, provider: null, lastRefreshedAt: null }, csv: { template: null, previewId: null, rowCount: 0, errors: [], duplicates: [] },
    };
    let tree: any;
    act(() => { tree = create(React.createElement(InvestmentOperations, { dark: false, ...data, initialAction: 'correction', onAction: (action: string, body?: string) => { void startWrite({ operationId: 'op-correction', action, body: body ?? '{}' }); } })); });
    const choose = (label: string) => act(() => { tree.root.findAllByProps({ accessibilityLabel: label }).at(-1).props.onPress(); });
    const fill = (label: string, value: string) => act(() => { tree.root.findByProps({ accessibilityLabel: label }).props.onChangeText(value); });
    choose('2026-10-01 · Existing contribution');
    choose('Use Maple brokerage');
    choose('contribution');
    fill('Event date (YYYY-MM-DD)', '2026-10-01');
    fill('Amount (for example 125.00)', '125.00');
    choose('Save correction');
    const payload = JSON.parse(startWrite.mock.calls[0][0].body);
    expect(payload.replacement).toMatchObject({ kind: 'contribution', linkedBankSourceId: 'tx-internal-only' });
    expect(JSON.stringify(tree.toJSON())).not.toContain('tx-internal-only');
  });

  it('allows a correction to choose a replacement confirmed bank record', () => {
    const startWrite = makeWrite();
    const data = {
      accounts: [{ id: 'brokerage', name: 'Maple brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD' }],
      instruments: [],
      events: [{ id: 'event-1', sourceId: 'source-1', date: '2026-10-01', kind: 'contribution', label: 'Existing contribution', accountId: 'brokerage', linkedBankSourceId: 'tx-old' }],
      bankTransactions: [{ id: 'tx-new', occurredAt: '2026-10-02', currency: 'CAD', signedMinorUnits: '12500', merchant: 'Corrected transfer', accountLabel: 'Everyday chequing', status: 'confirmed', sourceLabel: 'manual', category: 'Transfer', note: null, kind: 'income', revision: 3, accountId: 'bank' }],
      quote: { configured: false, provider: null, lastRefreshedAt: null }, csv: { template: null, previewId: null, rowCount: 0, errors: [], duplicates: [] },
    };
    let tree: any;
    act(() => { tree = create(React.createElement(InvestmentOperations, { dark: false, ...data, initialAction: 'correction', onAction: (action: string, body?: string) => { void startWrite({ operationId: 'op-correction-replacement', action, body: body ?? '{}' }); } })); });
    const choose = (label: string) => act(() => { tree.root.findAllByProps({ accessibilityLabel: label }).at(-1).props.onPress(); });
    const fill = (label: string, value: string) => act(() => { tree.root.findByProps({ accessibilityLabel: label }).props.onChangeText(value); });
    choose('2026-10-01 · Existing contribution');
    choose('Use Maple brokerage');
    choose('contribution');
    fill('Event date (YYYY-MM-DD)', '2026-10-02');
    fill('Amount (for example 125.00)', '125.00');
    choose('2026-10-02 · Corrected transfer · Everyday chequing · CAD 125.00');
    choose('Save correction');
    expect(JSON.parse(startWrite.mock.calls[0][0].body).replacement).toMatchObject({ linkedBankSourceId: 'tx-new' });
  });

  it('keeps the typed event identity stable across a retry and ignores revision changes', () => {
    const registry = new DraftOperationIdentityRegistry();
    const identity = registry.resolve('event', 'draft-1');
    const first = JSON.parse(safeEventPayload('event', JSON.stringify({ kind: 'contribution', accountId: 'brokerage', expectedRevision: 4 }), identity));
    const retry = JSON.parse(safeEventPayload('event', JSON.stringify({ kind: 'contribution', accountId: 'brokerage', expectedRevision: 4 }), registry.resolve('event', 'draft-1')));
    const refreshed = JSON.parse(safeEventPayload('event', JSON.stringify({ kind: 'contribution', accountId: 'brokerage', expectedRevision: 5 }), registry.resolve('event', 'draft-1')));
    expect(retry).toMatchObject({ id: first.id, sourceId: first.sourceId });
    expect(refreshed).toMatchObject({ id: first.id, sourceId: first.sourceId });
  });

  it('gives deliberate identical entries distinct identities after confirmation', () => {
    const registry = new DraftOperationIdentityRegistry();
    const body = JSON.stringify({ kind: 'dividend', accountId: 'brokerage', date: '2026-11-01', expectedRevision: 3 });
    const firstIdentity = registry.resolve('event', 'draft-1');
    const first = JSON.parse(safeEventPayload('event', body, firstIdentity));
    registry.markCompleted('event', 'draft-1');
    const secondIdentity = registry.resolve('event', 'draft-1');
    const second = JSON.parse(safeEventPayload('event', body, secondIdentity));
    expect(second.id).not.toBe(first.id);
    expect(second.sourceId).not.toBe(first.sourceId);
  });

  it('does not submit a contribution with a blank amount', () => {
    const startWrite = vi.fn();
    const { tree, fill } = contributionEditor((action, body) => startWrite(action, body));
    fill('Event date (YYYY-MM-DD)', '2026-11-01');
    const save = tree.root.findAllByProps({ accessibilityLabel: 'Save event' }).at(-1);
    expect(save.props.accessibilityState.disabled).toBe(true);
    expect(startWrite).not.toHaveBeenCalled();
  });

  it('does not submit an event with an impossible calendar date', () => {
    const startWrite = vi.fn();
    const { tree, fill } = contributionEditor((action, body) => startWrite(action, body));
    fill('Event date (YYYY-MM-DD)', '2026-02-30');
    fill('Amount (for example 125.00)', '125.00');
    const save = tree.root.findAllByProps({ accessibilityLabel: 'Save event' }).at(-1);
    expect(save.props.accessibilityState.disabled).toBe(true);
    expect(startWrite).not.toHaveBeenCalled();
  });

  it('submits a position transfer with its canonical instrument and quantity', () => {
    const startWrite = vi.fn();
    const data = {
      accounts: [
        { id: 'source', name: 'Source brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD' },
        { id: 'destination', name: 'Destination brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD' },
      ],
      instruments: [], events: [], bankTransactions: [],
      quote: { configured: false, provider: null, lastRefreshedAt: null },
      csv: { template: null, previewId: null, rowCount: 0, errors: [], duplicates: [] },
    };
    let tree: any;
    act(() => { tree = create(React.createElement(InvestmentOperations, { dark: false, ...data, initialAction: 'event', onAction: (action: string, body?: string) => startWrite(action, body) })); });
    const choose = (label: string) => act(() => { tree.root.findAllByProps({ accessibilityLabel: label }).at(-1).props.onPress(); });
    const fill = (label: string, value: string) => act(() => { tree.root.findByProps({ accessibilityLabel: label }).props.onChangeText(value); });
    choose('Use Source brokerage');
    choose('transfer');
    fill('Event date (YYYY-MM-DD)', '2026-11-01');
    choose('Position transfer');
    choose('Use Destination brokerage');
    fill('Ticker', 'VTI');
    fill('Quantity', '2.5');
    choose('Save event');
    expect(startWrite).toHaveBeenCalledWith('event', expect.any(String));
    expect(JSON.parse(startWrite.mock.calls[0][1])).toMatchObject({
      kind: 'transfer', transferKind: 'position', fromAccountId: 'source', toAccountId: 'destination',
      instrument: { exchange: 'TSX', ticker: 'VTI', type: 'stock', currency: 'CAD' }, quantity: '2.5',
    });
  });

  it('re-previews a selected file through typed canonical column mapping', () => {
    const remap = vi.fn();
    const data = {
      accounts: [], instruments: [], events: [],
      csv: { template: null, previewId: 'preview-1', rowCount: 1, errors: [], duplicates: [], sourceHeaders: ['posted_on', 'memo_text'], canonicalHeaders: ['date', 'memo'] },
      quote: { configured: false, provider: null, lastRefreshedAt: null },
    };
    let tree: any;
    act(() => { tree = create(React.createElement(InvestmentOperations, { dark: false, ...data, initialAction: 'csv-preview', csvSourceOperationId: 'pick', onCsvRemap: remap, onAction: vi.fn() })); });
    act(() => { tree.root.findByProps({ accessibilityLabel: 'Show CSV column mapping' }).props.onPress(); });
    act(() => { tree.root.findByProps({ accessibilityLabel: 'Choose source column for date' }).props.onPress(); });
    act(() => { tree.root.findByProps({ accessibilityLabel: 'posted_on for date' }).props.onPress(); });
    act(() => { tree.root.findByProps({ accessibilityLabel: 'Re-preview mapped CSV' }).props.onPress(); });
    expect(remap).toHaveBeenCalledWith({ date: 'posted_on' });
  });
});
