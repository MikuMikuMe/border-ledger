import { describe, expect, it } from 'vitest';
import { deriveAlertProjection, type AlertLink, type BankAlertEventInput, type InstrumentMapping } from '../src/domain/bank-alerts';
import { calculateSpending } from '../src/domain/ledger';
import type { Transaction } from '../src/domain/types';

const mapping: InstrumentMapping = { accountId: 'card-1', sourceProfileId: 'approved-boc', approved: true, allowedCurrencies: ['CAD', 'USD', 'HKD', 'CNY'] };
function event(overrides: Partial<BankAlertEventInput> = {}): BankAlertEventInput {
  return { schemaVersion: 1, eventId: 'purchase-1', observationId: 'observation-1', sourceProfileId: 'approved-boc', parserVersion: '1', notificationPostedAt: '2026-10-13T04:00:00.000Z', capturedAt: '2026-10-13T13:00:00.000Z', eventTimeBasis: 'notification_posted', eventType: 'purchase_notice', direction: 'outflow', eventMoney: { currency: 'CAD', amountMinor: 10000 }, primaryMoneyRole: 'transaction', amounts: [{ role: 'transaction', currency: 'CAD', amountMinor: 10000 }], feeTreatment: 'unknown', bankReference: null, bankDisplayedTime: null, merchant: 'Example Shop', completeness: { individualTimestamp: true, supportedSource: true, labeledMoney: true }, ...overrides };
}
function reversalEvent(overrides: Partial<BankAlertEventInput> = {}): BankAlertEventInput {
  return event({ eventId: 'reversal-1', observationId: 'observation-reversal-1', eventType: 'authorization_reversal', direction: 'none', ...overrides });
}
function link(overrides: Partial<AlertLink> = {}): AlertLink {
  return { fromEventId: 'reversal-1', toEventId: 'purchase-1', relation: 'partially_reverses', allocatedMoney: { currency: 'CAD', amountMinor: 3000 }, evidenceBasis: 'bank_reference', revision: 1, accountId: 'card-1', ...overrides };
}
function canonicalTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return { id: 'statement-refund', accountId: 'card-1', date: '2026-10-15', merchant: 'Example Shop', amountMinor: 3000, currency: 'CAD', category: 'Refunds', kind: 'refund', status: 'confirmed', source: 'statement', fingerprint: 'statement-row-1', ...overrides };
}

describe('alert projections', () => {
  it('keeps a declined attempt and a hold at zero without affecting an equal purchase', () => {
    expect(deriveAlertProjection(event({ eventId: 'failure', eventType: 'declined', direction: 'none' }), mapping, []).countedMoney).toBeNull();
    expect(deriveAlertProjection(event({ eventId: 'hold', eventType: 'hold_notice', direction: 'none' }), mapping, []).countedMoney).toBeNull();
    expect(deriveAlertProjection(event(), mapping, []).countedMoney).toEqual({ currency: 'CAD', amountMinor: 10000 });
  });

  it('holds an orphan reversal for review and voids a fully linked unposted purchase', () => {
    const purchase = event();
    const reversal = reversalEvent();
    const cancellation = link({ relation: 'cancels', allocatedMoney: { currency: 'CAD', amountMinor: 10000 } });
    expect(deriveAlertProjection(reversal, mapping, [])).toMatchObject({ state: 'needs_review', countedMoney: null, reasonCodes: ['orphan_reversal'] });
    expect(deriveAlertProjection(reversal, mapping, [cancellation], [purchase, reversal])).toMatchObject({ state: 'non_spending', countedMoney: null });
    expect(deriveAlertProjection(purchase, mapping, [cancellation], [purchase, reversal])).toMatchObject({ state: 'voided', countedMoney: null });
  });

  it('keeps a purchase and reversal reviewable when the reversal has an impossible live timestamp', () => {
    const purchase = event();
    const reversal = reversalEvent({ notificationPostedAt: '2026-02-30T04:00:00.000Z' });
    const cancellation = link({ relation: 'cancels', allocatedMoney: { currency: 'CAD', amountMinor: 10000 } });
    const events = [purchase, reversal];
    expect(deriveAlertProjection(purchase, mapping, [cancellation], events)).toMatchObject({ state: 'needs_review', countedMoney: null, reasonCodes: ['invalid_cancellation'] });
    expect(deriveAlertProjection(reversal, mapping, [cancellation], events)).toMatchObject({ state: 'needs_review', countedMoney: null, reasonCodes: ['invalid_cancellation'] });
  });

  it('reduces one provisional purchase by verified same-currency partial cancellation', () => {
    const purchase = event();
    const reversal = reversalEvent();
    expect(deriveAlertProjection(purchase, mapping, [link()], [purchase, reversal])).toMatchObject({ state: 'provisional', countedMoney: { currency: 'CAD', amountMinor: 7000 }, transaction: { amountMinor: -7000, status: 'provisional', source: 'alert' } });
  });

  it('reviews over-cancellation and cross-currency cancellation without negative impact', () => {
    const purchase = event();
    const reversal = reversalEvent();
    expect(deriveAlertProjection(purchase, mapping, [link({ allocatedMoney: { currency: 'CAD', amountMinor: 12000 } })], [purchase, reversal])).toMatchObject({ state: 'needs_review', countedMoney: null, reasonCodes: ['invalid_cancellation'] });
    expect(deriveAlertProjection(purchase, mapping, [link({ allocatedMoney: { currency: 'USD', amountMinor: 3000 } })], [purchase, reversal])).toMatchObject({ state: 'needs_review', countedMoney: null, reasonCodes: ['invalid_cancellation'] });
    const smallReversal = reversalEvent({ eventId: 'small-reversal', observationId: 'observation-small-reversal', eventMoney: { currency: 'CAD', amountMinor: 2000 }, amounts: [{ role: 'transaction', currency: 'CAD', amountMinor: 2000 }] });
    expect(deriveAlertProjection(purchase, mapping, [link({ fromEventId: smallReversal.eventId, allocatedMoney: { currency: 'CAD', amountMinor: 3000 } })], [purchase, smallReversal])).toMatchObject({ state: 'needs_review', countedMoney: null, reasonCodes: ['invalid_cancellation'] });
  });

  it('does not let one reversal allocation reduce two purchases', () => {
    const purchase1 = event();
    const purchase2 = event({ eventId: 'purchase-2', observationId: 'observation-2' });
    const reversal = reversalEvent({ eventMoney: { currency: 'CAD', amountMinor: 6000 }, amounts: [{ role: 'transaction', currency: 'CAD', amountMinor: 6000 }] });
    const links = [
      link({ toEventId: purchase1.eventId, allocatedMoney: { currency: 'CAD', amountMinor: 3000 } }),
      link({ toEventId: purchase2.eventId, allocatedMoney: { currency: 'CAD', amountMinor: 3000 } }),
    ];
    const events = [purchase1, purchase2, reversal];
    expect(deriveAlertProjection(purchase1, mapping, links, events)).toMatchObject({ state: 'needs_review', countedMoney: null, reasonCodes: ['invalid_cancellation'] });
    expect(deriveAlertProjection(purchase2, mapping, links, events)).toMatchObject({ state: 'needs_review', countedMoney: null, reasonCodes: ['invalid_cancellation'] });
    expect(deriveAlertProjection(reversal, mapping, links, events)).toMatchObject({ state: 'needs_review', countedMoney: null, reasonCodes: ['invalid_cancellation'] });
  });

  it('keeps orphan, missing-allocation, missing-target, and incompatible links reviewable', () => {
    const purchase = event();
    const reversal = reversalEvent();
    const events = [purchase, reversal];
    expect(deriveAlertProjection(purchase, mapping, [link({ fromEventId: 'missing-reversal' })], events)).toMatchObject({ state: 'needs_review', countedMoney: null, reasonCodes: ['invalid_cancellation'] });
    expect(deriveAlertProjection(reversal, mapping, [link({ allocatedMoney: null })], events)).toMatchObject({ state: 'needs_review', countedMoney: null, reasonCodes: ['invalid_cancellation'] });
    expect(deriveAlertProjection(reversal, mapping, [link({ toEventId: 'missing-purchase' })], events)).toMatchObject({ state: 'needs_review', countedMoney: null, reasonCodes: ['invalid_cancellation'] });
    expect(deriveAlertProjection(reversal, mapping, [link({ fromEventId: purchase.eventId, toEventId: reversal.eventId })], events)).toMatchObject({ state: 'needs_review', countedMoney: null, reasonCodes: ['invalid_cancellation'] });
    expect(deriveAlertProjection(purchase, mapping, [link(), link({ fromEventId: purchase.eventId, toEventId: reversal.eventId })], events)).toMatchObject({ state: 'needs_review', countedMoney: null, reasonCodes: ['invalid_cancellation'] });

    const differentInstrumentReversal = reversalEvent({ instrumentHint: { kind: 'card_suffix', value: '9999' } });
    const hintedPurchase = event({ instrumentHint: { kind: 'card_suffix', value: '1111' } });
    const incompatibleEvents = [hintedPurchase, differentInstrumentReversal];
    const incompatibleLink = link({ fromEventId: differentInstrumentReversal.eventId, toEventId: hintedPurchase.eventId });
    expect(deriveAlertProjection(hintedPurchase, mapping, [incompatibleLink], incompatibleEvents)).toMatchObject({ state: 'needs_review', countedMoney: null, reasonCodes: ['invalid_cancellation'] });
  });

  it('does not apply a cancellation link when its lifecycle source is not supplied', () => {
    const purchase = event();
    expect(deriveAlertProjection(purchase, mapping, [link()])).toMatchObject({ state: 'needs_review', countedMoney: null, reasonCodes: ['invalid_cancellation'] });
  });

  it('does not merge distinct equal purchases or possible duplicates', () => {
    const first = deriveAlertProjection(event(), mapping, [link({ relation: 'possible_duplicate' })]);
    const second = deriveAlertProjection(event({ eventId: 'purchase-2', observationId: 'observation-2' }), mapping, []);
    expect([first, second].map((item) => item.countedMoney?.amountMinor)).toEqual([10000, 10000]);
    expect([first, second].map((item) => item.transaction?.id)).toEqual(['purchase-1', 'purchase-2']);
  });

  it('excludes unresolved source, instrument, date, money, and invalid primary component', () => {
    expect(deriveAlertProjection(event(), null, [])).toMatchObject({ state: 'needs_review', countedMoney: null });
    expect(deriveAlertProjection(event({ sourceProfileId: 'generic-wechat' }), mapping, [])).toMatchObject({ state: 'needs_review', countedMoney: null });
    expect(deriveAlertProjection(event({ completeness: { individualTimestamp: false, supportedSource: true, labeledMoney: true } }), mapping, [])).toMatchObject({ state: 'needs_review', countedMoney: null });
    expect(deriveAlertProjection(event({ eventMoney: null }), mapping, [])).toMatchObject({ state: 'needs_review', countedMoney: null });
    expect(deriveAlertProjection(event({ amounts: [{ role: 'billing', currency: 'USD', amountMinor: 7300 }] }), mapping, [])).toMatchObject({ state: 'needs_review', countedMoney: null });
  });

  it('does not count a balance or included fee as an additional expense', () => {
    const result = deriveAlertProjection(event({ feeTreatment: 'included', amounts: [{ role: 'transaction', currency: 'CAD', amountMinor: 10000 }, { role: 'fee', currency: 'CAD', amountMinor: 500 }] }), mapping, []);
    expect(result.countedMoney).toEqual({ currency: 'CAD', amountMinor: 10000 });
    expect(result.transaction?.amountMinor).toBe(-10000);
  });

  it('counts a separately identified fee once and excludes repayment, transfer, adjustment and unknown notices', () => {
    const fee = event({ eventId: 'fee-1', eventType: 'fee_notice', feeTreatment: 'separate', eventMoney: { currency: 'CAD', amountMinor: 500 }, primaryMoneyRole: 'fee', amounts: [{ role: 'fee', currency: 'CAD', amountMinor: 500 }] });
    expect(deriveAlertProjection(fee, mapping, [])).toMatchObject({ state: 'provisional', countedMoney: { currency: 'CAD', amountMinor: 500 }, transaction: { kind: 'fee', amountMinor: -500 } });
    for (const eventType of ['repayment_notice', 'transfer_notice'] as const) {
      expect(deriveAlertProjection(event({ eventType, direction: 'none' }), mapping, []).countedMoney).toBeNull();
    }
    for (const eventType of ['adjustment_notice', 'unknown'] as const) {
      expect(deriveAlertProjection(event({ eventType }), mapping, [])).toMatchObject({ state: 'needs_review', countedMoney: null });
    }
  });

  it('refuses unapproved currencies, unsupported sources, and unverified or foreign-account links', () => {
    expect(deriveAlertProjection(event({ eventMoney: { currency: 'EUR', amountMinor: 10000 }, amounts: [{ role: 'transaction', currency: 'EUR', amountMinor: 10000 }] }), mapping, [])).toMatchObject({ state: 'needs_review', countedMoney: null });
    expect(deriveAlertProjection(event({ completeness: { individualTimestamp: true, supportedSource: false, labeledMoney: true } }), mapping, [])).toMatchObject({ state: 'needs_review', countedMoney: null });
    expect(deriveAlertProjection(event(), mapping, [link({ accountId: 'different-card' })])).toMatchObject({ state: 'needs_review', countedMoney: null, reasonCodes: ['invalid_cancellation'] });
    expect(deriveAlertProjection(event(), mapping, [link({ evidenceBasis: 'none' as 'bank_reference' })])).toMatchObject({ state: 'needs_review', countedMoney: null, reasonCodes: ['invalid_cancellation'] });
  });

  it('keeps a confirmation in review when its canonical transaction target is unresolved', () => {
    const refund = event({ eventId: 'refund-1', eventType: 'refund_notice', direction: 'inflow', eventMoney: { currency: 'CAD', amountMinor: 3000 }, amounts: [{ role: 'transaction', currency: 'CAD', amountMinor: 3000 }] });
    const confirmation = link({ fromEventId: refund.eventId, toEventId: undefined, toTransactionId: 'missing-canonical', relation: 'confirms', allocatedMoney: null });
    expect(deriveAlertProjection(refund, mapping, [confirmation], [], [])).toMatchObject({ state: 'needs_review', countedMoney: null, reasonCodes: ['awaiting_bank_credit'] });
  });

  it('keeps a confirmation in review when the resolved canonical target is incompatible', () => {
    const refund = event({ eventId: 'refund-1', eventType: 'refund_notice', direction: 'inflow', eventMoney: { currency: 'CAD', amountMinor: 3000 }, amounts: [{ role: 'transaction', currency: 'CAD', amountMinor: 3000 }] });
    const confirmation = link({ fromEventId: refund.eventId, toEventId: undefined, toTransactionId: 'statement-refund', relation: 'confirms', allocatedMoney: null });
    expect(deriveAlertProjection(refund, mapping, [confirmation], [], [canonicalTransaction({ accountId: 'different-card' })])).toMatchObject({ state: 'needs_review', countedMoney: null, reasonCodes: ['awaiting_bank_credit'] });
  });

  it('keeps a confirmation in review when two valid links resolve to two canonical targets', () => {
    const refund = event({ eventId: 'refund-1', eventType: 'refund_notice', direction: 'inflow', eventMoney: { currency: 'CAD', amountMinor: 3000 }, amounts: [{ role: 'transaction', currency: 'CAD', amountMinor: 3000 }] });
    const firstCanonical = canonicalTransaction({ id: 'statement-refund-1', fingerprint: 'statement-row-1' });
    const secondCanonical = canonicalTransaction({ id: 'statement-refund-2', fingerprint: 'statement-row-2' });
    const firstConfirmation = link({ fromEventId: refund.eventId, toEventId: undefined, toTransactionId: firstCanonical.id, relation: 'confirms', allocatedMoney: null });
    const secondConfirmation = link({ fromEventId: refund.eventId, toEventId: undefined, toTransactionId: secondCanonical.id, relation: 'confirms', allocatedMoney: null });
    expect(deriveAlertProjection(refund, mapping, [firstConfirmation, secondConfirmation], [], [firstCanonical, secondCanonical])).toMatchObject({ state: 'needs_review', countedMoney: null, reasonCodes: ['awaiting_bank_credit'] });
  });

  it('supersedes an alert once when a confirmed statement record exists, including a partial refund', () => {
    const refund = event({ eventId: 'refund-1', eventType: 'refund_notice', direction: 'inflow', eventMoney: { currency: 'CAD', amountMinor: 3000 }, amounts: [{ role: 'transaction', currency: 'CAD', amountMinor: 3000 }] });
    const canonical = canonicalTransaction();
    expect(deriveAlertProjection(refund, mapping, [link({ fromEventId: refund.eventId, toEventId: undefined, toTransactionId: canonical.id, relation: 'confirms', allocatedMoney: null })], [], [canonical])).toMatchObject({ state: 'superseded', countedMoney: null });
    expect(calculateSpending([canonical]).CAD).toBe(-3000);
  });
});
