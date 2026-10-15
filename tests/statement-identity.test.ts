import { describe, expect, it } from 'vitest';
import { parseStatementCsv } from '../src/domain/imports';
import { mergeImportedTransactions } from '../src/domain/ledger';
import {
  rankStatementCandidates,
  statementSourceIdentityKey,
  type StatementCandidateRecord,
  type StatementSourceIdentity,
} from '../src/domain/reconciliation';
import type { Transaction } from '../src/domain/types';

const FILE_A = 'a'.repeat(64);
const FILE_B = 'b'.repeat(64);

function statement(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'statement-1',
    accountId: 'card-1',
    date: '2026-10-12',
    merchant: 'Synthetic Cafe',
    amountMinor: -1200,
    currency: 'CAD',
    category: 'Food',
    kind: 'expense',
    status: 'confirmed',
    source: 'statement',
    fingerprint: 'same-candidate',
    sourceIdentity: { accountId: 'card-1', fileSha256: FILE_A, rowIndex: 0 },
    ...overrides,
  };
}

describe('statement source identity', () => {
  it('uses a bank row identity when available and a file row identity otherwise', () => {
    const strong: StatementSourceIdentity = {
      accountId: 'card-1',
      fileSha256: FILE_A,
      rowIndex: 4,
      bankSourceId: 'boc-export-1',
      bankRowId: 'row-44',
    };

    expect(statementSourceIdentityKey(strong)).toBe('statement:card-1:boc-export-1:row-44');
    expect(statementSourceIdentityKey({ ...strong, bankSourceId: undefined, bankRowId: undefined })).toBe(`statement:card-1:${FILE_A}:4`);
  });

  it('propagates the file hash and zero-based data-row index into parsed statement rows', () => {
    const result = parseStatementCsv(
      'Date,Description,Amount,Currency\n2026-10-12,Synthetic Cafe,-12.00,CAD\n2026-10-11,Synthetic Cafe,-12.00,CAD',
      { accountId: 'card-1', source: 'statement', fileSha256: FILE_A },
    );

    expect(result.errors).toEqual([]);
    expect(result.transactions.map((transaction) => transaction.sourceIdentity)).toEqual([
      { accountId: 'card-1', fileSha256: FILE_A, rowIndex: 0 },
      { accountId: 'card-1', fileSha256: FILE_A, rowIndex: 1 },
    ]);
  });

  it('retains a bank source and row ID as the stronger statement identity', () => {
    const result = parseStatementCsv(
      'Date,Description,Amount,Currency,Bank Source ID,Bank Row ID\n2026-10-12,Synthetic Cafe,-12.00,CAD,boc-export-1,row-44',
      { accountId: 'card-1', source: 'statement', fileSha256: FILE_A },
    );

    expect(result.transactions[0].sourceIdentity).toEqual({
      accountId: 'card-1',
      fileSha256: FILE_A,
      rowIndex: 0,
      bankSourceId: 'boc-export-1',
      bankRowId: 'row-44',
    });
  });

  it('deduplicates only a replayed source row while retaining equal rows from distinct source rows', () => {
    const first = statement();
    const replay = statement({ id: 'statement-replay' });
    const equalSecondRow = statement({
      id: 'statement-2',
      sourceIdentity: { accountId: 'card-1', fileSha256: FILE_A, rowIndex: 1 },
    });

    const merged = mergeImportedTransactions([first], [replay, equalSecondRow]);

    expect(merged.map((transaction) => transaction.id)).toEqual(['statement-1', 'statement-2']);
    expect(mergeImportedTransactions([], [first, equalSecondRow]).map((transaction) => transaction.id)).toEqual(['statement-1', 'statement-2']);
  });

  it('keeps identity-less statement rows distinct and reviewable instead of merging by fingerprint', () => {
    const existing = statement({ id: 'statement-existing', sourceIdentity: undefined });
    const imported = statement({ id: 'statement-imported', sourceIdentity: undefined });

    const merged = mergeImportedTransactions([existing], [imported]);

    expect(merged).toHaveLength(2);
    expect(merged.map((transaction) => transaction.id)).toEqual(['statement-existing', 'statement-imported']);
    expect(merged[0]).toMatchObject({ id: 'statement-existing', status: 'confirmed' });
    expect(merged[1]).toMatchObject({ id: 'statement-imported', status: 'needs_review' });
  });

  it('keeps an overlapping export as a review candidate instead of merging by amount', () => {
    const existing = statement();
    const overlap = statement({
      id: 'statement-overlap',
      sourceIdentity: { accountId: 'card-1', fileSha256: FILE_B, rowIndex: 0 },
    });

    const ranked = rankStatementCandidates(overlap, [existing]);

    expect(ranked).toHaveLength(1);
    expect(ranked[0]).toMatchObject({ candidateTransactionId: 'statement-1', score: 95 });
    expect(ranked[0].reasonCodes).toEqual(expect.arrayContaining(['same_amount', 'merchant_match', 'same_date']));
    expect(mergeImportedTransactions([existing], [overlap])).toMatchObject([
      { id: 'statement-1', status: 'confirmed' },
      { id: 'statement-overlap', status: 'needs_review' },
    ]);
  });

  it('does not mistake a repeated local preview ID for a replay when source identities differ', () => {
    const existing = statement({ id: 'import-1-2026-10-12' });
    const overlap = statement({
      id: 'import-1-2026-10-12',
      sourceIdentity: { accountId: 'card-1', fileSha256: FILE_B, rowIndex: 0 },
    });

    expect(rankStatementCandidates(overlap, [existing])).toHaveLength(1);
  });

  it('does not rank a same-amount row across currencies', () => {
    const row = statement({ currency: 'CNY', sourceIdentity: { accountId: 'card-1', fileSha256: FILE_B, rowIndex: 0 } });
    expect(rankStatementCandidates(row, [statement()])).toEqual([]);
  });
});

describe('statement and alert candidate ranking', () => {
  it('prefers a unique bank-reference match over weaker candidates', () => {
    const row = statement({ bankReference: 'bank-ref-1' });
    const alert: StatementCandidateRecord = {
      ...statement({ id: 'alert-1', source: 'alert', bankReference: 'bank-ref-1', sourceIdentity: undefined }),
    };
    const weaker: StatementCandidateRecord = {
      ...statement({ id: 'alert-2', source: 'alert', bankReference: 'other-ref', sourceIdentity: undefined }),
    };

    const ranked = rankStatementCandidates(row, [weaker, alert]);

    expect(ranked.map((result) => result.candidateTransactionId)).toEqual(['alert-1', 'alert-2']);
    expect(ranked[0]).toMatchObject({ score: 100, reasonCodes: expect.arrayContaining(['bank_reference']) });
  });

  it('retains two equal possible purchases as separately ranked candidates', () => {
    const row = statement({ sourceIdentity: { accountId: 'card-1', fileSha256: FILE_B, rowIndex: 9 } });
    const first = statement({ id: 'purchase-a', source: 'alert', sourceIdentity: undefined });
    const second = statement({ id: 'purchase-b', source: 'alert', sourceIdentity: undefined });

    expect(rankStatementCandidates(row, [second, first]).map((result) => result.candidateTransactionId)).toEqual(['purchase-a', 'purchase-b']);
  });
});
