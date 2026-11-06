import NativeSession from '../../native/specs/NativeSession';
import NativeLedger from '../../native/specs/NativeLedger';
import NativeAccounts, { type Account as NativeAccount } from '../../native/specs/NativeAccounts';
import NativeWealth from '../../native/specs/NativeWealth';
import type { WealthBankAccount, WealthCsvMapping, WealthReadQuery, WealthService } from './contracts';

const query = (value: WealthReadQuery = {}) => ({
  view: value.view,
  accountId: value.accountId ?? null,
  exchange: value.exchange ?? null,
  ticker: value.ticker ?? null,
  asOf: value.asOf ?? null,
  periodStart: value.periodStart ?? null,
  periodEnd: value.periodEnd ?? null,
});
const historyQuery = (accountId?: string | null) => ({ accountId: accountId ?? null });

export const nativeWealthService: WealthService = {
  read: (value = {}) => NativeWealth.readSnapshot(query(value)),
  onChanged: listener => NativeWealth.onStateChanged(listener),
  readBankAccounts: readBankAccounts,
  readBankTransactions: async () => readConfirmedTransactions(),
  readQuoteSettings: () => NativeWealth.readQuoteSettings(),
  readEvents: (accountId = null) => NativeWealth.readEvents(historyQuery(accountId)),
  readValuations: (accountId = null) => NativeWealth.readValuations(historyQuery(accountId)),
  readTemplate: () => NativeWealth.readTemplate(),
  startCsvImport: operationId => NativeWealth.startCsvImport(operationId),
  startCsvTemplate: operationId => NativeWealth.startCsvTemplate(operationId),
  startCsvRemap: (sourceOperationId, operationId, mapping: WealthCsvMapping) => NativeWealth.startCsvRemap(sourceOperationId, operationId, JSON.stringify(mapping)),
  readCsvPreview: operationId => NativeWealth.readCsvPreview(operationId),
  startWrite: (operationId, action, body) => NativeWealth.startWrite(operationId, action, body),
};

async function readBankAccounts(): Promise<WealthBankAccount[]> {
  const ledger = await NativeLedger.getSnapshot();
  const metadata = await readAccountMetadata();
  return ledger?.accounts.map(account => {
    const currencies = new Set(account.currencies);
    const matches = metadata.filter(candidate => candidate.name.trim().toLocaleLowerCase() === account.displayName.trim().toLocaleLowerCase());
    matches.forEach(candidate => currencies.add(candidate.currency));
    return { id: account.id, name: account.displayName, institution: account.institution, currencies: [...currencies] };
  }) ?? [];
}

async function readAccountMetadata(): Promise<NativeAccount[]> {
  const rows: NativeAccount[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  try {
    for (let page = 0; page < 100; page += 1) {
      const result = await NativeAccounts.readAccounts({ cursor, limit: 100 });
      rows.push(...result.accounts);
      const next = result.nextCursor;
      if (!next || seenCursors.has(next)) break;
      seenCursors.add(next);
      cursor = next;
    }
  } catch {
    // The ledger snapshot remains the authoritative local-account identity.
  }
  return rows;
}

async function readConfirmedTransactions() {
  const rows = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < 1000; page += 1) {
    const result = await NativeLedger.readTransactions({ cursor, limit: 100, query: null, currency: null, status: 'confirmed', source: null, category: null });
    rows.push(...result.items);
    const next = result.nextCursor;
    if (!next || seenCursors.has(next)) break;
    seenCursors.add(next);
    cursor = next;
  }
  return rows;
}

export const nativeWealthPorts = {
  read: nativeWealthService.read,
  startCsvImport: nativeWealthService.startCsvImport,
  startCsvTemplate: nativeWealthService.startCsvTemplate,
  startCsvRemap: nativeWealthService.startCsvRemap,
  readCsvPreview: nativeWealthService.readCsvPreview,
  startWrite: nativeWealthService.startWrite,
  readOperations: (offset: number, limit: number) => NativeSession.readOperations({ offset, limit }),
  queryOperation: (operationId: string) => NativeSession.queryOperation({ operationId }),
  onChanged: (listener: (value: string) => void) => NativeWealth.onStateChanged(listener),
};
