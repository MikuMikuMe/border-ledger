import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../mobile/package.json', import.meta.url));
const React = require('react');
const { act, create } = require('react-test-renderer');

vi.mock('../mobile/node_modules/react-native/index.js', () => ({
  Text: 'Text', View: 'View', Pressable: 'Pressable', TextInput: 'TextInput', ActivityIndicator: 'ActivityIndicator', Modal: 'Modal', ScrollView: 'ScrollView', KeyboardAvoidingView: 'KeyboardAvoidingView',
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
  TurboModuleRegistry: { getEnforcing: () => ({}) },
}));

const { InvestmentOperations, newDraftId } = await import('../mobile/src/features/wealth/WealthViews');
const { DraftOperationIdentityRegistry, safeEventPayload } = await import('../mobile/src/screens/WealthScreen');

type WriteCall = { operationId: string; action: string; body: string };
type ActionHandler = (action: string, body?: string) => void;
type WriteSink = (call: WriteCall) => unknown;
type Choice = { label: string };
type Field = { label: string; value: string };
type EditorData = Record<string, unknown>;
type EditorContext = { tree: any; choose(choice: Choice): void; fill(field: Field): void };

function makeWrite() {
  return vi.fn(async ({ operationId, action, body }: WriteCall) => ({ operationId, kind: action, status: 'completed', updatedAt: '', resultId: null, body }));
}

function makeActionHandler({ startWrite, operationId }: { startWrite: WriteSink; operationId: string }): ActionHandler {
  return (...args: [string, string?]) => {
    const [action, body] = args;
    void startWrite({ operationId, action, body: body ?? '{}' });
  };
}

function renderEditor({ data, initialAction, onAction }: { data: EditorData; initialAction: string; onAction: ActionHandler }): EditorContext {
  let tree: any;
  act(() => { tree = create(React.createElement(InvestmentOperations, { dark: false, ...data, initialAction, onAction })); });
  const choose = ({ label }: Choice) => act(() => { tree.root.findAllByProps({ accessibilityLabel: label }).at(-1).props.onPress(); });
  const fill = ({ label, value }: Field) => act(() => { tree.root.findByProps({ accessibilityLabel: label }).props.onChangeText(value); });
  return { tree, choose, fill };
}

function contributionEditor({ onAction }: { onAction: ActionHandler }): EditorContext {
  const data = {
    accounts: [{ id: 'brokerage', name: 'Maple brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD' }],
    instruments: [], events: [], bankTransactions: [], quote: { configured: false, provider: null, lastRefreshedAt: null },
    csv: { template: null, previewId: null, rowCount: 0, errors: [], duplicates: [] },
  };
  const context = renderEditor({ data, initialAction: 'event', onAction });
  context.choose({ label: 'Use Maple brokerage' });
  context.choose({ label: 'contribution' });
  return context;
}

function accountEditor({ data, onAction }: { data: EditorData; onAction: ActionHandler }): EditorContext {
  return renderEditor({ data, initialAction: 'account', onAction });
}

function saveAccountTransition({ mode, targetLabel, date, valueLabel, value }: { mode: 'aggregate' | 'holdings'; targetLabel: string; date: string; valueLabel: string; value: string }) {
  const startWrite = makeWrite();
  const { tree, choose, fill } = accountEditor({
    data: {
      accounts: [{ id: 'brokerage', name: 'Maple brokerage', kind: 'brokerage', mode, currency: 'CAD' }],
      instruments: [], events: [], bankTransactions: [],
      quote: { configured: false, provider: null, lastRefreshedAt: null },
      csv: { template: null, previewId: null, rowCount: 0, errors: [], duplicates: [] },
    },
    onAction: makeActionHandler({ startWrite, operationId: 'op-account-transition' }),
  });
  chooseAccountAndFill({ choose, fill, targetLabel, date, valueLabel, value });
  const save = tree.root.findAllByProps({ accessibilityLabel: 'Save account' }).at(-1);
  act(() => { save.props.onPress(); });
  return { startWrite, payload: JSON.parse(startWrite.mock.calls[0][0].body) as Record<string, unknown>, save };
}

function chooseAccountAndFill({ choose, fill, targetLabel, date, valueLabel, value }: { choose: EditorContext['choose']; fill: EditorContext['fill']; targetLabel: string; date: string; valueLabel: string; value: string }) {
  choose({ label: 'Use Maple brokerage' });
  choose({ label: targetLabel });
  fill({ label: 'Effective date (YYYY-MM-DD)', value: date });
  fill({ label: valueLabel, value });
}

describe('Android Wealth typed write flow', () => {
  it('uses Web Crypto entropy when randomUUID is unavailable', () => {
    const originalCrypto = (globalThis as { crypto?: unknown }).crypto;
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.set(Uint8Array.from([0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]));
      return bytes;
    });
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues } });
    try {
      expect(newDraftId()).toBe('00112233-4455-4677-8899-aabbccddeeff');
      expect(getRandomValues).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto });
    }
  });

  it('submits a generated account identity through the injected service action', () => {
    const startWrite = makeWrite();
    const data = { accounts: [], instruments: [], events: [], quote: { configured: false, provider: null, lastRefreshedAt: null }, csv: { template: null, previewId: null, rowCount: 0, errors: [], duplicates: [] } };
    const { tree } = renderEditor({ data, initialAction: 'account', onAction: makeActionHandler({ startWrite, operationId: 'op-account' }) });
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

  it('submits a dated zero opening valuation for a new aggregate account', () => {
    const startWrite = makeWrite();
    const { tree, choose, fill } = accountEditor({ data: {
      accounts: [], instruments: [], events: [], bankTransactions: [],
      quote: { configured: false, provider: null, lastRefreshedAt: null },
      csv: { template: null, previewId: null, rowCount: 0, errors: [], duplicates: [] },
    }, onAction: makeActionHandler({ startWrite, operationId: 'op-account' }) });
    fill({ label: 'Account name', value: 'Zero manual asset' });
    choose({ label: 'manual asset' });
    const openingDate = tree.root.findByProps({ accessibilityLabel: 'Opening date (YYYY-MM-DD)' });
    expect(openingDate.props.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    fill({ label: 'Opening date (YYYY-MM-DD)', value: '' });
    fill({ label: 'Opening value (optional, for example 1250.00)', value: '0' });
    const saveBeforeDate = tree.root.findAllByProps({ accessibilityLabel: 'Save account' }).at(-1);
    expect(saveBeforeDate.props.accessibilityState.disabled).toBe(true);
    fill({ label: 'Opening date (YYYY-MM-DD)', value: '2026-11-03' });
    const save = tree.root.findAllByProps({ accessibilityLabel: 'Save account' }).at(-1);
    expect(save.props.accessibilityState.disabled).toBe(false);
    act(() => { save.props.onPress(); });
    expect(JSON.parse(startWrite.mock.calls[0][0].body)).toMatchObject({
      kind: 'manual_asset', mode: 'aggregate', amountMinor: 0, asOf: '2026-11-03',
    });
  });

  it('does not turn a new holdings account amount into an undated valuation', () => {
    const startWrite = makeWrite();
    const { tree, fill } = accountEditor({ data: {
      accounts: [], instruments: [], events: [], bankTransactions: [],
      quote: { configured: false, provider: null, lastRefreshedAt: null },
      csv: { template: null, previewId: null, rowCount: 0, errors: [], duplicates: [] },
    }, onAction: makeActionHandler({ startWrite, operationId: 'op-account' }) });
    fill({ label: 'Account name', value: 'New brokerage' });
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Opening amount (optional; not a dated value)' })).toHaveLength(0);
    const save = tree.root.findAllByProps({ accessibilityLabel: 'Save account' }).at(-1);
    expect(save.props.accessibilityState.disabled).toBe(false);
    act(() => { save.props.onPress(); });
    const payload = JSON.parse(startWrite.mock.calls[0][0].body) as Record<string, unknown>;
    expect(payload).toMatchObject({ kind: 'brokerage', mode: 'holdings', amountMinor: null });
    expect(payload).not.toHaveProperty('asOf');
  });

  it('submits an aggregate-to-holdings account transition atomically', () => {
    const { startWrite, payload, save } = saveAccountTransition({ mode: 'aggregate', targetLabel: 'Holdings (securities + cash)', date: '2026-11-01', valueLabel: 'Opening cash (for example 1250.00)', value: '1250.00' });
    expect(save.props.accessibilityState.disabled).toBe(false);
    expect(startWrite).toHaveBeenCalledTimes(1);
    expect(startWrite.mock.calls[0][0].action).toBe('account');
    expect(payload).toMatchObject({ id: 'brokerage', mode: 'holdings', effectiveDate: '2026-11-01', openingCashMinor: 125000, amountMinor: null });
    expect(payload).not.toHaveProperty('openingValueMinor');
  });

  it('submits a canonical opening position when cash is not supplied', () => {
    const startWrite = makeWrite();
    const { tree, choose, fill } = accountEditor({ data: {
      accounts: [{ id: 'brokerage', name: 'Maple brokerage', kind: 'brokerage', mode: 'aggregate', currency: 'CAD' }],
      instruments: [{ exchange: 'TSX', ticker: 'SHOP', type: 'stock', currency: 'CAD' }], events: [], bankTransactions: [],
      quote: { configured: false, provider: null, lastRefreshedAt: null },
      csv: { template: null, previewId: null, rowCount: 0, errors: [], duplicates: [] },
    }, onAction: makeActionHandler({ startWrite, operationId: 'op-account' }) });
    choose({ label: 'Use Maple brokerage' });
    choose({ label: 'Holdings (securities + cash)' });
    fill({ label: 'Effective date (YYYY-MM-DD)', value: '2026-11-01' });
    choose({ label: 'TSX:SHOP · stock · CAD' });
    fill({ label: 'Opening quantity', value: '3' });
    const save = tree.root.findAllByProps({ accessibilityLabel: 'Save account' }).at(-1);
    expect(save.props.accessibilityState.disabled).toBe(false);
    act(() => { save.props.onPress(); });
    const payload = JSON.parse(startWrite.mock.calls[0][0].body);
    expect(payload).toMatchObject({ mode: 'holdings', effectiveDate: '2026-11-01', openingPositions: [{ instrument: { exchange: 'TSX', ticker: 'SHOP', type: 'stock', currency: 'CAD' }, quantity: '3' }] });
    expect(payload).not.toHaveProperty('openingCashMinor');
  });

  it('submits a holdings-to-aggregate account transition atomically', () => {
    const { startWrite, payload, save } = saveAccountTransition({ mode: 'holdings', targetLabel: 'Aggregate (one dated value)', date: '2026-11-02', valueLabel: 'Opening aggregate value (for example 1250.00)', value: '980.00' });
    expect(save.props.accessibilityState.disabled).toBe(false);
    expect(startWrite).toHaveBeenCalledTimes(1);
    expect(payload).toMatchObject({ id: 'brokerage', mode: 'aggregate', effectiveDate: '2026-11-02', openingValueMinor: 98000, amountMinor: null });
    expect(payload).not.toHaveProperty('openingCashMinor');
    expect(payload).not.toHaveProperty('openingPositions');
  });

  it('keeps a mode transition disabled until its effective date and opening state are valid', () => {
    const startWrite = makeWrite();
    const { tree, choose, fill } = accountEditor({ data: {
      accounts: [{ id: 'brokerage', name: 'Maple brokerage', kind: 'brokerage', mode: 'aggregate', currency: 'CAD' }],
      instruments: [], events: [], bankTransactions: [],
      quote: { configured: false, provider: null, lastRefreshedAt: null },
      csv: { template: null, previewId: null, rowCount: 0, errors: [], duplicates: [] },
    }, onAction: makeActionHandler({ startWrite, operationId: 'op-account' }) });
    choose({ label: 'Use Maple brokerage' });
    choose({ label: 'Holdings (securities + cash)' });
    fill({ label: 'Effective date (YYYY-MM-DD)', value: '2026-02-30' });
    let save = tree.root.findAllByProps({ accessibilityLabel: 'Save account' }).at(-1);
    expect(save.props.accessibilityState.disabled).toBe(true);
    fill({ label: 'Effective date (YYYY-MM-DD)', value: '2026-11-01' });
    save = tree.root.findAllByProps({ accessibilityLabel: 'Save account' }).at(-1);
    expect(save.props.accessibilityState.disabled).toBe(true);
    fill({ label: 'Opening cash (for example 1250.00)', value: '-125.00' });
    save = tree.root.findAllByProps({ accessibilityLabel: 'Save account' }).at(-1);
    expect(save.props.accessibilityState.disabled).toBe(true);
    fill({ label: 'Opening cash (for example 1250.00)', value: '125.00' });
    save = tree.root.findAllByProps({ accessibilityLabel: 'Save account' }).at(-1);
    expect(save.props.accessibilityState.disabled).toBe(false);
  });

  it('keeps manual assets, debts, and linked bank accounts aggregate-only', () => {
    const startWrite = makeWrite();
    const { tree, choose } = accountEditor({ data: { accounts: [], instruments: [], events: [], bankTransactions: [], quote: { configured: false, provider: null, lastRefreshedAt: null }, csv: { template: null, previewId: null, rowCount: 0, errors: [], duplicates: [] } }, onAction: makeActionHandler({ startWrite, operationId: 'op-account' }) });
    choose({ label: 'manual asset' });
    const holdings = tree.root.findByProps({ accessibilityLabel: 'Holdings (securities + cash)' });
    expect(holdings.props.accessibilityState.disabled).toBe(true);
    const save = tree.root.findAllByProps({ accessibilityLabel: 'Save account' }).at(-1);
    act(() => { save.props.onPress(); });
    expect(JSON.parse(startWrite.mock.calls[0][0].body)).toMatchObject({ kind: 'manual_asset', mode: 'aggregate' });
  });

  it('links a typed wealth event to a human-readable bank record without exposing its id', () => {
    const startWrite = makeWrite();
    const data = {
      accounts: [{ id: 'brokerage', name: 'Maple brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD' }],
      instruments: [], events: [], quote: { configured: false, provider: null, lastRefreshedAt: null },
      csv: { template: null, previewId: null, rowCount: 0, errors: [], duplicates: [] },
      bankTransactions: [{ id: 'tx-internal-only', occurredAt: '2026-11-01', currency: 'CAD', signedMinorUnits: '12500', merchant: 'Brokerage transfer', accountLabel: 'Everyday chequing', status: 'confirmed', sourceLabel: 'manual', category: 'Transfer', note: null, kind: 'income', revision: 3, accountId: 'bank' }],
    };
    const { tree, choose, fill } = renderEditor({ data, initialAction: 'event', onAction: makeActionHandler({ startWrite, operationId: 'op-event' }) });
    choose({ label: 'Use Maple brokerage' });
    choose({ label: 'contribution' });
    fill({ label: 'Event date (YYYY-MM-DD)', value: '2026-11-01' });
    fill({ label: 'Amount (for example 125.00)', value: '125.00' });
    choose({ label: '2026-11-01 · Brokerage transfer · Everyday chequing · CAD 125.00' });
    choose({ label: 'Save event' });
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
    const { tree, choose, fill } = renderEditor({ data, initialAction: 'correction', onAction: makeActionHandler({ startWrite, operationId: 'op-correction' }) });
    choose({ label: '2026-10-01 · Existing contribution' });
    choose({ label: 'Use Maple brokerage' });
    choose({ label: 'contribution' });
    fill({ label: 'Event date (YYYY-MM-DD)', value: '2026-10-01' });
    fill({ label: 'Amount (for example 125.00)', value: '125.00' });
    choose({ label: 'Save correction' });
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
    const { tree, choose, fill } = renderEditor({ data, initialAction: 'correction', onAction: makeActionHandler({ startWrite, operationId: 'op-correction-replacement' }) });
    choose({ label: '2026-10-01 · Existing contribution' });
    choose({ label: 'Use Maple brokerage' });
    choose({ label: 'contribution' });
    fill({ label: 'Event date (YYYY-MM-DD)', value: '2026-10-02' });
    fill({ label: 'Amount (for example 125.00)', value: '125.00' });
    choose({ label: '2026-10-02 · Corrected transfer · Everyday chequing · CAD 125.00' });
    choose({ label: 'Save correction' });
    expect(JSON.parse(startWrite.mock.calls[0][0].body).replacement).toMatchObject({ linkedBankSourceId: 'tx-new' });
  });

  it('keeps the typed event identity stable across a retry and ignores revision changes', () => {
    const registry = new DraftOperationIdentityRegistry();
    const identity = registry.resolve({ action: 'event', draftId: 'draft-1' });
    const first = JSON.parse(safeEventPayload({ action: 'event', body: JSON.stringify({ kind: 'contribution', accountId: 'brokerage', expectedRevision: 4 }), identity }));
    const retry = JSON.parse(safeEventPayload({ action: 'event', body: JSON.stringify({ kind: 'contribution', accountId: 'brokerage', expectedRevision: 4 }), identity: registry.resolve({ action: 'event', draftId: 'draft-1' }) }));
    const refreshed = JSON.parse(safeEventPayload({ action: 'event', body: JSON.stringify({ kind: 'contribution', accountId: 'brokerage', expectedRevision: 5 }), identity: registry.resolve({ action: 'event', draftId: 'draft-1' }) }));
    expect(retry).toMatchObject({ id: first.id, sourceId: first.sourceId });
    expect(refreshed).toMatchObject({ id: first.id, sourceId: first.sourceId });
  });

  it.each(['running', 'saving', 'reconciliation_required', 'checking'])('preserves a draft identity while its outcome is %s', status => {
    const registry = new DraftOperationIdentityRegistry();
    const request = { action: 'event', draftId: 'draft-unresolved' };
    const identity = registry.resolve(request);
    registry.settle({ ...request, identity, status });
    expect(registry.resolve(request)).toBe(identity);
  });

  it.each(['completed', 'rejected', 'revision_conflict', 'failed_local', 'canceled'])('starts a fresh operation after the definitive %s result', status => {
    const registry = new DraftOperationIdentityRegistry();
    const request = { action: 'event', draftId: 'draft-terminal' };
    const identity = registry.resolve(request);
    registry.settle({ ...request, identity, status });
    expect(registry.resolve(request)).not.toBe(identity);
  });

  it.each(['event', 'correction', 'reversal', 'csv-export'])('retires definitive outcomes without letting an older receipt clear a newer %s draft', action => {
    const registry = new DraftOperationIdentityRegistry();
    const request = { action, draftId: 'draft-settled' };
    const first = registry.resolve(request);
    registry.settle({ ...request, identity: first, status: 'rejected' });
    const next = registry.resolve(request);
    expect(next).not.toBe(first);
    registry.settle({ ...request, identity: first, status: 'completed' });
    expect(registry.resolve(request)).toBe(next);
  });

  it('gives deliberate identical entries distinct identities after confirmation', () => {
    const registry = new DraftOperationIdentityRegistry();
    const body = JSON.stringify({ kind: 'dividend', accountId: 'brokerage', date: '2026-11-01', expectedRevision: 3 });
    const firstIdentity = registry.resolve({ action: 'event', draftId: 'draft-1' });
    const first = JSON.parse(safeEventPayload({ action: 'event', body, identity: firstIdentity }));
    registry.settle({ action: 'event', draftId: 'draft-1', identity: firstIdentity, status: 'completed' });
    const secondIdentity = registry.resolve({ action: 'event', draftId: 'draft-1' });
    const second = JSON.parse(safeEventPayload({ action: 'event', body, identity: secondIdentity }));
    expect(second.id).not.toBe(first.id);
    expect(second.sourceId).not.toBe(first.sourceId);
  });

  it('does not submit a contribution with a blank amount', () => {
    const startWrite = makeWrite();
    const { tree, fill } = contributionEditor({ onAction: makeActionHandler({ startWrite, operationId: 'op-event' }) });
    fill({ label: 'Event date (YYYY-MM-DD)', value: '2026-11-01' });
    const save = tree.root.findAllByProps({ accessibilityLabel: 'Save event' }).at(-1);
    expect(save.props.accessibilityState.disabled).toBe(true);
    expect(startWrite).not.toHaveBeenCalled();
  });

  it('does not submit an event with an impossible calendar date', () => {
    const startWrite = makeWrite();
    const { tree, fill } = contributionEditor({ onAction: makeActionHandler({ startWrite, operationId: 'op-event' }) });
    fill({ label: 'Event date (YYYY-MM-DD)', value: '2026-02-30' });
    fill({ label: 'Amount (for example 125.00)', value: '125.00' });
    const save = tree.root.findAllByProps({ accessibilityLabel: 'Save event' }).at(-1);
    expect(save.props.accessibilityState.disabled).toBe(true);
    expect(startWrite).not.toHaveBeenCalled();
  });

  it('submits a position transfer with its canonical instrument and quantity', () => {
    const startWrite = makeWrite();
    const data = {
      accounts: [
        { id: 'source', name: 'Source brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD' },
        { id: 'destination', name: 'Destination brokerage', kind: 'brokerage', mode: 'holdings', currency: 'CAD' },
      ],
      instruments: [], events: [], bankTransactions: [],
      quote: { configured: false, provider: null, lastRefreshedAt: null },
      csv: { template: null, previewId: null, rowCount: 0, errors: [], duplicates: [] },
    };
    const { tree, choose, fill } = renderEditor({ data, initialAction: 'event', onAction: makeActionHandler({ startWrite, operationId: 'op-transfer' }) });
    choose({ label: 'Use Source brokerage' });
    choose({ label: 'transfer' });
    fill({ label: 'Event date (YYYY-MM-DD)', value: '2026-11-01' });
    choose({ label: 'Position transfer' });
    choose({ label: 'Use Destination brokerage' });
    fill({ label: 'Ticker', value: 'VTI' });
    fill({ label: 'Quantity', value: '2.5' });
    choose({ label: 'Save event' });
    expect(startWrite).toHaveBeenCalledWith(expect.objectContaining({ operationId: 'op-transfer', action: 'event', body: expect.any(String) }));
    expect(JSON.parse(startWrite.mock.calls[0][0].body)).toMatchObject({
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
    expect(tree.root.findAllByType('Modal')).toHaveLength(1);
    expect(tree.root.findByType('KeyboardAvoidingView').props.behavior).toBe('padding');
    act(() => { tree.root.findByProps({ accessibilityLabel: 'Choose source column for date' }).props.onPress(); });
    expect(tree.root.findAllByType('Modal')).toHaveLength(1);
    act(() => { tree.root.findByProps({ accessibilityLabel: 'posted_on for date' }).props.onPress(); });
    act(() => { tree.root.findByProps({ accessibilityLabel: 'Re-preview mapped CSV' }).props.onPress(); });
    expect(remap).toHaveBeenCalledWith({ date: 'posted_on' });
  });
});
