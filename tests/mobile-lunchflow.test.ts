import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { DetailsController } from '../mobile/src/features/details/DetailsController';
import type { DetailsPorts, LunchFlowAccounts } from '../mobile/src/features/details/contracts';
import { account, connection, link, receipt } from './fixtures/mobile-details';

vi.mock('../mobile/node_modules/react-native/index.js', () => ({
  Text: 'Text', View: 'View', Pressable: 'Pressable', TextInput: 'TextInput', ActivityIndicator: 'ActivityIndicator',
  Modal: 'Modal', KeyboardAvoidingView: 'KeyboardAvoidingView', ScrollView: 'ScrollView',
  AccessibilityInfo: { setAccessibilityFocus: () => {} }, findNodeHandle: () => null, StyleSheet: { create: (value: unknown) => value },
}));

const connectionStatus:import('../mobile/src/features/details/contracts').LunchFlowConnection={userId:'owner',ledgerId:'personal',connectionId:'lf',generation:2,adapter:'personal',configured:true,connected:true,canReconnect:false,reconnectRequired:false,remoteRevocation:'not_requested',reason:'legacy_cutover_required',retryable:false};
const lunchFlow: LunchFlowAccounts = {
  configured: true,connectionId:'lf',generation:2,
  accounts: [
    {
      connectionId:'lf',providerBankConnectionId:null,lastAttemptAt:null,
      providerAccountId: 'lf-chequing-1',
      name: 'Everyday chequing',
      institution: 'RBC',
      currencies: ['CAD'],
      selected: true,
      accountId: 'account-lf-1',
      kind: 'chequing',
      currency: 'CAD',
      lastSyncedAt: '2026-10-22T12:00:00Z',
      lastError: null,
    },
    {
      connectionId:'lf',providerBankConnectionId:null,lastAttemptAt:null,
      providerAccountId: 'lf-visa-1',
      name: 'RBC Visa',
      institution: 'RBC',
      currencies: ['CAD'],
      selected: false,
      accountId: null,
      kind: null,
      currency: null,
      lastSyncedAt: null,
      lastError: 'provider_unavailable',
    },
  ],
};

function fixture() {
  const writes: unknown[] = [];
  const counts = { discoveryReads: 0 };
  let current = lunchFlow;
  const op = async (kind: string, ...args: unknown[]) => {
    writes.push([kind, ...args]);
    return receipt(String(args[0]), kind);
  };
  const ports: DetailsPorts = {
    session: { readOperations: async () => [], queryOperation: async () => null },
    recurring: {
      readDetail: async () => ({ stream: {} as never, history: [], nextCursor: null, limit: 50, classification: 'unclassified' }),
      startClassify: async (...args) => op('recurring_classify', ...args),
      onChanged: () => ({ remove: () => {} }),
    },
    review: {
      readAlerts: async () => ({ items: [], nextCursor: null, limit: 50 }),
      startReview: async (...args) => op('review', ...args),
      startAnnotate: async (...args) => op('annotate', ...args),
      onChanged: () => ({ remove: () => {} }),
    },
    accounts: {
      readLunchFlowConnection:async()=>(connectionStatus),
      getSnapshot: async () => link,
      readAccounts: async () => ({ accounts: [account], nextCursor: null, limit: 50 }),
      readConnections: async () => [connection],
      readLunchFlowAccounts: async () => { counts.discoveryReads += 1; return current; },
      startConnect: async (...args) => op('plaid', ...args),
      cancelConnect: async (...args) => op('cancel_connect', ...args),
      startSelectAccounts: async (...args) => op('select_accounts', ...args),
      startCancelPending: async (...args) => op('cancel_pending', ...args),
      startSync: async (...args) => op('bank_sync', ...args),
      startDisconnect: async (...args) => op('disconnect', ...args),
      startLunchFlowAccountSelection: async (operationId, selections) => {
        writes.push(['lunchflow_selection', operationId, selections]);
        current = {
          ...current,
          accounts: current.accounts.map(value => ({
            ...value,
            selected: selections.some(selection => selection.providerAccountId === value.providerAccountId),
          })),
        };
        return receipt(operationId, 'lunchflow_selection');
      },
      startLunchFlowSync: async (...args) => op('lunchflow_sync', ...args),
      onStateChanged: () => ({ remove: () => {} }),
    },
  };
  return { ports, writes, counts };
}

describe('mobile LunchFlow account controller', () => {
  it('loads provider discovery and sends an explicit whole-selection with currency and kind', async () => {
    const fixtureValue = fixture();
    const controller = new DetailsController(fixtureValue.ports);
    await controller.start();

    expect(controller.accounts.current().data?.lunchFlow).toEqual(lunchFlow);
    await controller.selectLunchFlow({
      operationId: 'lunchflow-select-1',
      accounts: [{ providerAccountId: 'lf-visa-1', currency: 'CAD', kind: 'credit' }],
    });

    expect(fixtureValue.writes).toContainEqual([
      'lunchflow_selection',
      'lunchflow-select-1',
      [{ providerAccountId: 'lf-visa-1', currency: 'CAD', kind: 'credit' }],
    ]);
    expect(controller.accounts.current().data?.lunchFlow?.accounts.find(value => value.providerAccountId === 'lf-visa-1')?.selected).toBe(true);
    controller.dispose();
  });

  it('enqueues LunchFlow refresh and keeps the provider error visible until the next read', async () => {
    const fixtureValue = fixture();
    const controller = new DetailsController(fixtureValue.ports);
    await controller.start();
    await controller.syncLunchFlow({ operationId: 'lunchflow-sync-1' });
    expect(fixtureValue.writes).toContainEqual(['lunchflow_sync', 'lunchflow-sync-1',{connectionId:'lf',expectedGeneration:2}]);
    expect(controller.accounts.current().data?.lunchFlow?.accounts[1]?.lastError).toBe('provider_unavailable');
    controller.dispose();
  });

  it('polls local status for a changed provider error without repeating discovery', async () => {
    const fixtureValue = fixture();
    let localReads = 0;
    const localStatus: LunchFlowAccounts = {
      ...lunchFlow,
      accounts: lunchFlow.accounts.map((account, index) => index === 0 ? { ...account, lastError: 'provider_timeout' } : account),
    };
    const ports: DetailsPorts = {
      ...fixtureValue.ports,
      accounts: {
        ...fixtureValue.ports.accounts,
        readLunchFlowStatus: async () => { localReads += 1; return localStatus; },
      },
    };
    const controller = new DetailsController(ports);
    await controller.start();
    await controller.syncLunchFlow({ operationId: 'lunchflow-sync-error-1' });

    expect(localReads).toBe(1);
    expect(fixtureValue.counts.discoveryReads).toBe(1);
    expect(controller.accounts.current().data?.lunchFlow?.accounts[0]?.lastError).toBe('provider_timeout');
    controller.dispose();
  });

  it('keeps LunchFlow busy through status reconciliation and ignores duplicate writes', async () => {
    const fixtureValue = fixture();
    let syncCalls = 0;
    let releaseWrite!: () => void;
    const writeGate = new Promise<void>(resolve => { releaseWrite = resolve; });
    const localStatus: LunchFlowAccounts = {
      ...lunchFlow,
      accounts: lunchFlow.accounts.map((account, index) => index === 0 ? { ...account, lastError: 'provider_timeout' } : account),
    };
    const ports: DetailsPorts = {
      ...fixtureValue.ports,
      accounts: {
        ...fixtureValue.ports.accounts,
        startLunchFlowSync: async operationId => {
          syncCalls += 1;
          await writeGate;
          return receipt(operationId, 'lunchflow_sync');
        },
        readLunchFlowStatus: async () => localStatus,
      },
    };
    const controller = new DetailsController(ports);
    await controller.start();

    const first = controller.syncLunchFlow({ operationId: 'lunchflow-sync-busy-1' });
    expect(controller.lunchFlowBusy).toBe(true);
    const duplicate = controller.syncLunchFlow({ operationId: 'lunchflow-sync-busy-2' });
    releaseWrite();
    await Promise.all([first, duplicate]);

    expect(syncCalls).toBe(1);
    expect(controller.lunchFlowBusy).toBe(false);
    controller.dispose();
  });

  it('refreshes the shared ledger when local status reconciliation fails', async () => {
    const fixtureValue = fixture();
    let localReads = 0;
    let ledgerRefreshes = 0;
    const ports: DetailsPorts = {
      ...fixtureValue.ports,
      accounts: {
        ...fixtureValue.ports.accounts,
        readLunchFlowStatus: async () => {
          localReads += 1;
          throw new Error('status unavailable');
        },
      },
      refreshLedger: async () => { ledgerRefreshes += 1; },
    };
    const controller = new DetailsController(ports);
    await controller.start();

    await controller.syncLunchFlow({ operationId: 'lunchflow-sync-status-failure' });

    expect(localReads).toBe(1);
    expect(ledgerRefreshes).toBe(1);
    expect(controller.lunchFlowBusy).toBe(false);
    controller.dispose();
  });
});

describe('mobile LunchFlow account view', () => {
  it('renders errors and explicit selectors without exposing provider credentials', async () => {
    const require = createRequire(new URL('../mobile/package.json', import.meta.url));
    const React = require('react');
    const { AccountsView } = await import('../mobile/src/features/details/DetailsViews');
    const props = {
      dark: false,
      state: { phase: 'ready', data: { page: { accounts: [], nextCursor: null, limit: 50 }, connections: [], link, lunchFlow,lunchFlowConnection:connectionStatus }, message: null },
      mutation: { blocked: false, status: 'ready' },
      onRetry: () => {}, onLoadMore: () => {}, onConnect: () => {}, onCancelConnect: () => {}, onSelect: () => {}, onCancel: () => {}, onSync: () => {}, onDisconnect: () => {},
      onLunchFlowSelection: () => {}, onLunchFlowSync: () => {},
    };
    const renderer = require('react-test-renderer');
    let tree: any;
    renderer.act(() => { tree = renderer.create(React.createElement(AccountsView, props)); });
    const text = tree.root.findAll((node: any) => node.type === 'Text').map((node: any) => node.children.join('')).join('\n');
    expect(text).toContain('provider_unavailable');
    expect(text).toContain('Lunch Flow');
    expect(text).not.toContain('LUNCHFLOW_API_KEY');
  });

  it('disables LunchFlow controls while reconciliation is active', async () => {
    const require = createRequire(new URL('../mobile/package.json', import.meta.url));
    const React = require('react');
    const { AccountsView } = await import('../mobile/src/features/details/DetailsViews');
    const props = {
      dark: false,
      state: { phase: 'ready', data: { page: { accounts: [], nextCursor: null, limit: 50 }, connections: [], link, lunchFlow,lunchFlowConnection:connectionStatus }, message: null },
      mutation: { blocked: false, status: 'ready' },
      lunchFlowBusy: true,
      onRetry: () => {}, onLoadMore: () => {}, onConnect: () => {}, onCancelConnect: () => {}, onSelect: () => {}, onCancel: () => {}, onSync: () => {}, onDisconnect: () => {},
    };
    const renderer = require('react-test-renderer');
    let tree: any;
    renderer.act(() => { tree = renderer.create(React.createElement(AccountsView, props)); });
    const controls = tree.root.findAll((node: any) => typeof node.props?.accessibilityLabel === 'string' && node.props.accessibilityLabel.includes('Lunch Flow'));
    expect(controls.length).toBeGreaterThan(0);
    expect(controls.every((node: any) => node.props.disabled === true)).toBe(true);
  });
});
