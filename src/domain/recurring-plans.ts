export type PlanFrequency = 'weekly' | 'biweekly' | 'monthly' | 'yearly';
export interface RecurringPlan {
  id: string; accountId: string; currency: string; merchant: string;
  direction: 'expense' | 'income'; amountMinor: number; frequency: PlanFrequency;
  startDate: string; endDate: string | null; enabled: boolean; revision: number;
}
export interface PlanTransaction {
  id: string; accountId: string; currency: string; merchant: string; kind: string;
  amountMinor: number; status: string; date: string;
}
export interface AccountFreshness { assessable: boolean; lastSuccessfulDate: string | null }
export type OccurrenceStatus = 'expected' | 'matched' | 'pending' | 'ambiguous' | 'potentially_missing' | 'not_assessable';
export type PlanCandidate = Pick<PlanTransaction, 'id' | 'date' | 'merchant' | 'amountMinor' | 'currency' | 'status'>;
export interface PlanOccurrence { planId: string; date: string; status: OccurrenceStatus; candidateIds: string[]; candidateCount: number; candidateDetails: PlanCandidate[] }

const DAY = 86_400_000;
function validPlanDateText(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '1800-01-01' && value <= '2199-12-31';
}
function validPlanDateValue(date: Date, value: string): boolean {
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function parsePlanDate(value: string): Date {
  if (!validPlanDateText(value)) throw new Error('Invalid date');
  const date = new Date(`${value}T00:00:00Z`);
  if (!validPlanDateValue(date, value)) throw new Error('Invalid date');
  return date;
}
function iso(date: Date): string { return date.toISOString().slice(0, 10); }
export function addPlanDays(date: string, days: number): string { return iso(new Date(parsePlanDate(date).getTime() + days * DAY)); }
function scheduledDate(anchor: Date, frequency: PlanFrequency, index: number): string {
  if (frequency === 'weekly' || frequency === 'biweekly') return iso(new Date(anchor.getTime() + index * (frequency === 'weekly' ? 7 : 14) * DAY));
  const months = index * (frequency === 'yearly' ? 12 : 1);
  const target = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(anchor.getUTCDate(), last));
  return iso(target);
}
function initialIndex(plan: RecurringPlan, start: Date, first: Date): number {
  const delta = Math.max(0, first.getTime() - start.getTime());
  const monthDelta = (first.getUTCFullYear() - start.getUTCFullYear()) * 12 + first.getUTCMonth() - start.getUTCMonth();
  if (plan.frequency === 'weekly' || plan.frequency === 'biweekly') {
    const interval = plan.frequency === 'weekly' ? 7 : 14;
    return Math.max(0, Math.floor(delta / (interval * DAY)) - 1);
  }
  return Math.max(0, Math.floor(monthDelta / (plan.frequency === 'yearly' ? 12 : 1)) - 1);
}
function outsidePlan(plan: RecurringPlan, from: string, to: string): boolean {
  if (!plan.enabled || to < plan.startDate) return true;
  return plan.endDate !== null && from > plan.endDate;
}
function validateRange(first: Date, last: Date) {
  if (first > last) throw new Error('Invalid occurrence range');
  if (last.getTime() - first.getTime() > (5 * 366 + 28) * DAY) throw new Error('Invalid occurrence range');
}
function collectDates(plan: RecurringPlan, start: Date, first: Date, range: {from:string;to:string}): string[] {
  const result: string[] = [];
  // Jump near the query start instead of walking every historical period.
  let index = initialIndex(plan, start, first);
  for (; ; index++) {
    const date = scheduledDate(start, plan.frequency, index);
    if (date > range.to) break;
    if (plan.endDate && date > plan.endDate) break;
    if (date >= range.from) result.push(date);
  }
  return result;
}
export function occurrences(plan: RecurringPlan, from: string, to: string): string[] {
  const start = parsePlanDate(plan.startDate), first = parsePlanDate(from), last = parsePlanDate(to);
  if (plan.endDate) parsePlanDate(plan.endDate);
  validateRange(first, last);
  if (outsidePlan(plan, from, to)) return [];
  return collectDates(plan, start, first, {from,to});
}
