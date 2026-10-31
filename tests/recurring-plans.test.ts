import { describe, expect, it } from 'vitest';
import { occurrences, type RecurringPlan, type PlanTransaction } from '../src/domain/recurring-plans';
import { assessOccurrences as assess } from '../src/domain/recurring-plan-matching';
const assessOccurrences = (plans: Parameters<typeof assess>[0]['plans'], transactions: Parameters<typeof assess>[0]['transactions'], freshness: Parameters<typeof assess>[0]['freshness'], today:string, from:string, to:string) => assess({plans,transactions,freshness,today,from,to});

const plan: RecurringPlan = { id: 'p', accountId: 'a', currency: 'CAD', merchant: 'Netflix', direction: 'expense', amountMinor: 1500, frequency: 'monthly', startDate: '2024-01-31', endDate: null, enabled: true, revision: 0 };
const transaction: PlanTransaction = { id: 't', accountId: 'a', currency: 'CAD', merchant: ' NETFLIX ', kind: 'expense', amountMinor: -1500, status: 'confirmed', date: '2024-02-29' };
const fresh = { a: { assessable: true, lastSuccessfulDate: '2024-03-10' } };

describe('recurring plans', () => {
  it('preserves month-end and leap-year anchors', () => {
    expect(occurrences(plan, '2024-01-01', '2024-04-30')).toEqual(['2024-01-31', '2024-02-29', '2024-03-31', '2024-04-30']);
    expect(occurrences({ ...plan, frequency: 'yearly', startDate: '2024-02-29' }, '2025-01-01', '2028-12-31')).toEqual(['2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
  });
  it('honors biweekly cadence and inclusive end dates', () => {
    expect(occurrences({...plan, frequency:'biweekly', startDate:'2026-01-01', endDate:'2026-01-29'}, '2026-01-01', '2026-02-28')).toEqual(['2026-01-01','2026-01-15','2026-01-29']);
  });
  it('rejects dates beyond the supported calendar before recurrence expansion', () => {
    expect(() => occurrences({ ...plan, startDate: '2200-01-01' }, '2200-01-01', '2200-12-31')).toThrow();
  });
  it('matches confirmed transactions by account, currency, payee, amount and kind', () => {
    expect(assessOccurrences([plan], [transaction], fresh, '2024-03-10', '2024-02-29', '2024-02-29')[0]).toMatchObject({ status: 'matched', candidateIds: ['t'], candidateDetails: [{id:'t',merchant:' NETFLIX ',date:'2024-02-29',amountMinor:-1500,currency:'CAD',status:'confirmed'}] });
    expect(assessOccurrences([plan], [{ ...transaction, currency: 'CNY' }], fresh, '2024-03-10', '2024-02-29', '2024-02-29')[0].status).toBe('potentially_missing');
  });
  it('distinguishes pending, ambiguity and unassessable data', () => {
    expect(assessOccurrences([plan], [{ ...transaction, status: 'provisional' }], fresh, '2024-03-10', '2024-02-29', '2024-02-29')[0].status).toBe('pending');
    expect(assessOccurrences([plan], [transaction, { ...transaction, id: 't2' }], fresh, '2024-03-10', '2024-02-29', '2024-02-29')[0].status).toBe('ambiguous');
    expect(assessOccurrences([plan], [], {}, '2024-03-10', '2024-02-29', '2024-02-29')[0].status).toBe('not_assessable');
    expect(assessOccurrences([plan], [], fresh, '2024-03-04', '2024-02-29', '2024-02-29')[0].status).toBe('expected');
  });
  it('detects competition from an occurrence just outside the requested range', () => {
    const first = { ...plan, frequency: 'weekly' as const, startDate: '2024-02-22' };
    const result = assessOccurrences([first], [transaction], fresh, '2024-03-10', '2024-02-29', '2024-02-29');
    expect(result[0].status).toBe('ambiguous');
  });
  it('bounds the candidate preview while retaining ambiguity', () => {
    const candidates = Array.from({length: 20}, (_, i) => ({...transaction, id: `tx-${i}`}));
    const result = assessOccurrences([plan], candidates, fresh, '2024-03-10', '2024-02-29', '2024-02-29')[0];
    expect(result.status).toBe('ambiguous');
    expect(result.candidateIds.length).toBeLessThanOrEqual(2);
    expect(result.candidateCount).toBe(20);
  });
  it('limits excessive matching work instead of returning incomplete results', () => {
    const candidates = Array.from({length:1001}, (_, i) => ({...transaction, id:`tx-${i}`}));
    const plans = Array.from({length:101}, (_, i) => ({...plan,id:`plan-${i}`}));
    expect(() => assessOccurrences(plans, candidates, fresh, '2024-03-10', '2024-02-29', '2024-02-29')).toThrow('Too many');
  });
  it('does not flag missed payments using an old sync even if it followed the due window', () => {
    const stale = { a: { assessable: false, lastSuccessfulDate: '2024-03-10' } };
    expect(assessOccurrences([plan], [], stale, '2024-04-01', '2024-02-29', '2024-02-29')[0].status).toBe('not_assessable');
  });
  it('does not assign one transaction to overlapping plans', () => {
    const result = assessOccurrences([plan, { ...plan, id: 'other' }], [transaction], fresh, '2024-03-10', '2024-02-29', '2024-02-29');
    expect(result.map(item => item.status)).toEqual(['ambiguous', 'ambiguous']);
  });
});
