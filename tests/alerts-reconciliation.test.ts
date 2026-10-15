import { describe, expect, it } from 'vitest';
import {
  applyLifecycleAllocations,
  matchStatementToAlert,
  type LifecycleAllocation,
  type LifecyclePurchase,
  type LifecycleReversal,
  type StatementCandidateRecord,
} from '../src/domain/reconciliation';

function purchase(overrides: Partial<LifecyclePurchase> = {}): LifecyclePurchase {
  return {
    id: 'purchase-1',
    accountId: 'card-1',
    instrumentId: 'visa-1111',
    currency: 'CAD',
    amountMinor: 10000,
    status: 'provisional',
    ...overrides,
  };
}

function reversal(overrides: Partial<LifecycleReversal> = {}): LifecycleReversal {
  return {
    id: 'reversal-1',
    accountId: 'card-1',
    instrumentId: 'visa-1111',
    currency: 'CAD',
    amountMinor: 10000,
    ...overrides,
  };
}

function allocation(overrides: Partial<LifecycleAllocation> = {}): LifecycleAllocation {
  return {
    reversalId: 'reversal-1',
    purchaseId: 'purchase-1',
    currency: 'CAD',
    amountMinor: 10000,
    evidenceBasis: 'bank_reference',
    ...overrides,
  };
}

describe('alert lifecycle reconciliation', () => {
  it('keeps a reversal-before-purchase reviewable until the explicitly linked purchase is present', () => {
    const result = applyLifecycleAllocations(purchase(), [], [allocation()]);
    expect(result).toMatchObject({ state: 'needs_review', remainingMinor: null, reasonCodes: ['orphan_reversal'] });

    const linked = applyLifecycleAllocations(purchase(), [reversal()], [allocation()]);
    expect(linked).toMatchObject({ state: 'voided', remainingMinor: 0 });
  });

  it('reduces a purchase by a same-currency partial allocation and voids it at full allocation', () => {
    const partial = applyLifecycleAllocations(purchase(), [reversal({ amountMinor: 3000 })], [allocation({ amountMinor: 3000 })]);
    expect(partial).toMatchObject({ state: 'provisional', remainingMinor: 7000 });

    const full = applyLifecycleAllocations(purchase(), [reversal()], [allocation()]);
    expect(full).toMatchObject({ state: 'voided', remainingMinor: 0 });
  });

  it('does not let a reversal allocation cross currencies or choose between equal purchases by amount', () => {
    expect(applyLifecycleAllocations(purchase(), [reversal({ currency: 'CNY' })], [allocation({ currency: 'CNY' })])).toMatchObject({
      state: 'needs_review',
      remainingMinor: null,
      reasonCodes: ['cross_currency'],
    });

    const equalPurchase = purchase({ id: 'purchase-2' });
    const result = applyLifecycleAllocations(purchase(), [reversal()], [allocation({ purchaseId: equalPurchase.id })]);
    expect(result).toMatchObject({ state: 'needs_review', reasonCodes: ['target_not_found'] });
  });

  it('keeps a reversal without an instrument reviewable when the purchase identifies one', () => {
    const result = applyLifecycleAllocations(purchase(), [reversal({ instrumentId: undefined })], [allocation()]);

    expect(result).toMatchObject({ state: 'needs_review', remainingMinor: null, reasonCodes: ['cross_instrument'] });
  });

  it('requires bank-reference evidence before reducing a confirmed charge', () => {
    const result = applyLifecycleAllocations(purchase({ status: 'confirmed' }), [reversal()], [allocation({ evidenceBasis: 'user_review' })]);
    expect(result).toMatchObject({ state: 'needs_review', remainingMinor: null, reasonCodes: ['confirmed_without_bank_reference'] });
  });
});

describe('statement and alert matching', () => {
  it('accepts a unique same-currency bank-reference match and leaves cross-currency references unmatched', () => {
    const statement: StatementCandidateRecord = {
      id: 'statement-1',
      accountId: 'card-1',
      date: '2026-10-12',
      merchant: 'Synthetic Cafe',
      amountMinor: -10000,
      currency: 'CAD',
      kind: 'expense',
      bankReference: 'bank-ref-1',
    };
    const alert: StatementCandidateRecord = {
      ...statement,
      id: 'alert-1',
      source: 'alert',
      sourceIdentity: undefined,
    };
    const crossCurrency: StatementCandidateRecord = { ...alert, id: 'alert-cny', currency: 'CNY' };

    expect(matchStatementToAlert(statement, [alert])).toMatchObject({ alertId: 'alert-1', basis: 'bank_reference', score: 100 });
    expect(matchStatementToAlert(statement, [crossCurrency])).toBeNull();
  });
});
