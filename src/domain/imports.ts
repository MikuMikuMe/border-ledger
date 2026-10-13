import { classifyTransaction } from './ledger';
import type { Currency, Transaction, TransactionSource } from './types';

interface ImportOptions {
  accountId: string;
  source: TransactionSource;
}

export interface ImportResult {
  transactions: Transaction[];
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

function toMinorUnits(rawAmount: string): number | null {
  const normalized = rawAmount.replace(/[,$¥￥\s]/g, '').replace(/\(([^)]+)\)/, '-$1');
  if (!normalized || !/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

function makeFingerprint(date: string, merchant: string, amountMinor: number, currency: Currency) {
  return [date, merchant.toLowerCase().replace(/\s+/g, ' '), amountMinor, currency].join('|');
}

export function parseStatementCsv(input: string, options: ImportOptions): ImportResult {
  const rows = parseCsvRows(input);
  if (rows.length === 0) return { transactions: [], errors: ['The file has no rows.'] };

  const headers = rows[0].map((header) => header.toLowerCase().replace(/[^a-z]/g, ''));
  const column = (aliases: string[]) => headers.findIndex((header) => aliases.includes(header));
  const dateColumn = column(['date', 'transactiondate', 'posteddate']);
  const descriptionColumn = column(['description', 'merchant', 'name', 'details']);
  const amountColumn = column(['amount', 'transactionamount', 'value']);
  const currencyColumn = column(['currency', 'ccy']);
  const categoryColumn = column(['category', 'type']);
  const errors: string[] = [];
  const transactions: Transaction[] = [];

  if (dateColumn < 0 || descriptionColumn < 0 || amountColumn < 0) {
    return { transactions: [], errors: ['Required columns are Date, Description, and Amount.'] };
  }

  rows.slice(1).forEach((row, rowIndex) => {
    const date = row[dateColumn]?.trim();
    const merchant = row[descriptionColumn]?.trim();
    const amountMinor = toMinorUnits(row[amountColumn] ?? '');
    const currency = (row[currencyColumn] || 'CAD').trim().toUpperCase();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) errors.push(`Row ${rowIndex + 2}: date must use YYYY-MM-DD.`);
    if (!merchant) errors.push(`Row ${rowIndex + 2}: description is empty.`);
    if (amountMinor === null) errors.push(`Row ${rowIndex + 2}: amount is not a valid number.`);
    if (currency !== 'CAD' && currency !== 'CNY') errors.push(`Row ${rowIndex + 2}: currency must be CAD or CNY.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !merchant || amountMinor === null || (currency !== 'CAD' && currency !== 'CNY')) return;

    const kind = classifyTransaction({ amountMinor, description: merchant });
    transactions.push({
      id: `import-${rowIndex + 1}-${date}`,
      accountId: options.accountId,
      date,
      merchant,
      amountMinor,
      currency: currency as Currency,
      category: row[categoryColumn]?.trim() || (kind === 'transfer' ? 'Transfers' : kind === 'refund' ? 'Refunds' : 'Uncategorized'),
      kind,
      status: 'confirmed',
      source: options.source,
      fingerprint: makeFingerprint(date, merchant, amountMinor, currency as Currency),
    });
  });

  return { transactions, errors };
}

