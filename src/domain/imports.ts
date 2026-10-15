import { classifyTransaction } from './ledger';
import { getCurrencyMeta, parseMoneyMinor, type CurrencyRegistry, type CurrencyCode } from './currencies';
import { statementSourceIdentityKey, type StatementSourceIdentity } from './reconciliation';
import type { Currency, Transaction, TransactionSource } from './types';

export { statementSourceIdentityKey } from './reconciliation';
export { findBankReferenceMatches, matchStatementToAlert, rankStatementCandidates } from './reconciliation';
export type { StatementSourceIdentity } from './reconciliation';
export type { StatementCandidate, StatementCandidateRecord, StatementCandidateResult, StatementAlertMatch } from './reconciliation';

export interface ImportOptions {
  accountId: string;
  source: TransactionSource;
  registry?: CurrencyRegistry;
  defaultCurrency?: CurrencyCode;
  fileSha256?: string;
  bankSourceId?: string | null;
}

export interface ImportResult<Code extends CurrencyCode = Currency> {
  transactions: Transaction<Code>[];
  errors: string[];
}

function parseCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    const next = input[index + 1];
    if (character === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(field.trim());
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && next === '\n') index += 1;
      row.push(field.trim());
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }

  row.push(field.trim());
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function toMinorUnits(rawAmount: string, currency: CurrencyCode, registry?: CurrencyRegistry): number | null {
  const normalized = rawAmount.trim().replace(/^\(([^)]+)\)$/, '-$1').replace(/,(?=\d{3}(?:\D|$))/g, '');
  try {
    return parseMoneyMinor(normalized, currency, registry);
  } catch {
    return null;
  }
}

function makeFingerprint(date: string, merchant: string, amountMinor: number, currency: CurrencyCode) {
  return [date, merchant.toLowerCase().replace(/\s+/g, ' '), amountMinor, currency].join('|');
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z]/g, '');
}

export function parseStatementCsv(input: string, options: ImportOptions & { registry: CurrencyRegistry }): ImportResult<CurrencyCode>;
export function parseStatementCsv(input: string, options: ImportOptions): ImportResult;
export function parseStatementCsv(input: string, options: ImportOptions): ImportResult<CurrencyCode> {
  const rows = parseCsvRows(input);
  if (rows.length === 0) return { transactions: [], errors: ['The file has no rows.'] };

  const headers = rows[0].map(normalizeHeader);
  const column = (aliases: string[]) => headers.findIndex((header) => aliases.includes(header));
  const dateColumn = column(['date', 'transactiondate', 'posteddate']);
  const descriptionColumn = column(['description', 'merchant', 'name', 'details']);
  const amountColumn = column(['amount', 'transactionamount', 'value']);
  const currencyColumn = column(['currency', 'ccy']);
  const categoryColumn = column(['category', 'type']);
  const bankSourceColumn = column(['banksourceid', 'sourceid', 'banksource']);
  const bankRowColumn = column(['bankrowid', 'rowid', 'statementrowid', 'banktransactionid']);
  const bankReferenceColumn = column(['bankreference', 'reference', 'referencenumber', 'transactionreference']);
  const errors: string[] = [];
  const transactions: Transaction<CurrencyCode>[] = [];

  if (dateColumn < 0 || descriptionColumn < 0 || amountColumn < 0) {
    return { transactions: [], errors: ['Required columns are Date, Description, and Amount.'] };
  }

  rows.slice(1).forEach((row, rowIndex) => {
    const date = row[dateColumn]?.trim();
    const merchant = row[descriptionColumn]?.trim();
    const currency = (currencyColumn < 0 ? options.defaultCurrency ?? '' : row[currencyColumn] ?? '').trim().toUpperCase();
    const validCurrency = getCurrencyMeta(currency, options.registry) !== null;
    const amountMinor = validCurrency ? toMinorUnits(row[amountColumn] ?? '', currency, options.registry) : null;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) errors.push(`Row ${rowIndex + 2}: date must use YYYY-MM-DD.`);
    if (!merchant) errors.push(`Row ${rowIndex + 2}: description is empty.`);
    if (amountMinor === null) errors.push(`Row ${rowIndex + 2}: amount is not a valid number.`);
    if (!validCurrency) errors.push(`Row ${rowIndex + 2}: currency must be registered.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !merchant || amountMinor === null || !validCurrency) return;

    const kind = classifyTransaction({ amountMinor, description: merchant });
    let sourceIdentity: StatementSourceIdentity | undefined;
    if (options.source === 'statement' && options.fileSha256 !== undefined) {
      const bankSourceId = options.bankSourceId?.trim() || row[bankSourceColumn]?.trim() || undefined;
      const bankRowId = row[bankRowColumn]?.trim() || undefined;
      const candidateIdentity: StatementSourceIdentity = {
        accountId: options.accountId,
        fileSha256: options.fileSha256,
        rowIndex,
        bankSourceId,
        bankRowId,
      };
      try {
        statementSourceIdentityKey(candidateIdentity);
        sourceIdentity = candidateIdentity;
      } catch {
        errors.push(`Row ${rowIndex + 2}: statement source identity is invalid.`);
        return;
      }
    }
    const transactionId = sourceIdentity
      ? `import-${sourceIdentity.fileSha256.toLowerCase()}-${sourceIdentity.rowIndex}-${date}`
      : `import-${rowIndex + 1}-${date}`;
    transactions.push({
      id: transactionId,
      accountId: options.accountId,
      date,
      merchant,
      amountMinor,
      currency,
      category: row[categoryColumn]?.trim() || (kind === 'transfer' ? 'Transfers' : kind === 'refund' ? 'Refunds' : 'Uncategorized'),
      kind,
      status: 'confirmed',
      source: options.source,
      fingerprint: makeFingerprint(date, merchant, amountMinor, currency),
      bankReference: bankReferenceColumn < 0 ? undefined : row[bankReferenceColumn]?.trim() || null,
      sourceIdentity,
    });
  });

  return { transactions, errors };
}

