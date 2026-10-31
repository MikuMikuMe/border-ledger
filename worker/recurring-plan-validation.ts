import type { PlanInput } from './recurring-plans';

const frequencies = new Set(['weekly', 'biweekly', 'monthly', 'yearly']);
export function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  if (value < '1900-01-01' || value > '2100-12-31') return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function validAccountId(value: unknown): boolean {
  return typeof value === 'string' && value.length >= 1 && value.length <= 128;
}
function validCurrency(value: unknown): boolean {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value);
}
function validMerchantAndDirection(merchant: string, direction: string): boolean {
  return Boolean(merchant) && merchant.length <= 120 && ['income', 'expense'].includes(direction);
}
function validateIdentity({accountId,currency,merchant,direction}: PlanInput) {
  if (!validAccountId(accountId)) throw new RangeError('Invalid account');
  if (!validCurrency(currency)) throw new RangeError('Invalid currency');
  if (!validMerchantAndDirection(merchant, direction)) throw new RangeError('Invalid merchant or direction');
}
function validEndDate(startDate: string, endDate: string | null): boolean {
  return endDate === null || (validDate(endDate) && endDate >= startDate);
}
function validateAmount(amountMinor: number) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new RangeError('Invalid amount');
}
function validateDates({startDate,endDate}: PlanInput) {
  if (!validDate(startDate)) throw new RangeError('Invalid plan dates');
  if (!validEndDate(startDate, endDate)) throw new RangeError('Invalid plan dates');
}
function validateSchedule(input: PlanInput) {
  validateAmount(input.amountMinor);
  if (!frequencies.has(input.frequency)) throw new RangeError('Invalid frequency');
  validateDates(input);
}
function normalizeMerchant(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}
export function normalizePlan(input: PlanInput): PlanInput {
  if (!input || typeof input !== 'object') throw new RangeError('Invalid recurring plan');
  const { accountId, currency, direction, amountMinor, frequency, startDate, endDate } = input;
  const merchant = normalizeMerchant(input.merchant);
  const normalized = { accountId, currency, merchant, direction, amountMinor, frequency, startDate, endDate };
  validateIdentity(normalized);
  validateSchedule(normalized);
  return normalized;
}
