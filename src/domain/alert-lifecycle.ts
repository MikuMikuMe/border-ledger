export type EventTimeBasis = 'notification_posted' | 'bank_transaction_date' | 'statement_posting_date' | 'unresolved';
export type EventTimePrecision = 'millisecond' | 'date' | 'unknown';

export interface EventTimeInput {
  mode: 'live' | 'historical';
  notificationPostedAt: string | null;
  individualTimestamp?: boolean;
  capturedAt?: string;
  bankDisplayedTime?: string | null;
  bankTransactionDate?: string | null;
  statementPostingDate?: string | null;
  reportingZone?: string;
}

export interface ResolvedEventTime {
  occurredAt: string | null;
  reportingDate: string | null;
  localDateTime: string | null;
  basis: EventTimeBasis;
  precision: EventTimePrecision;
  inferredYear: number | null;
  statementPostingDate: string | null;
}

function instantDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new RangeError('A timestamp with a timezone is required.');
  if (!isGregorianDate(`${match[1]}-${match[2]}-${match[3]}`)) throw new RangeError('Invalid timestamp.');
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new RangeError('Invalid timestamp.');
  return date;
}

function localParts(date: Date, zone: string): Record<string, string> {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

function isGregorianDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

export function reportingDateForInstant(instant: string, zone: string): string {
  const parts = localParts(instantDate(instant), zone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function resolveEventTime(input: EventTimeInput): ResolvedEventTime {
  const zone = input.reportingZone ?? 'America/Toronto';
  const base = { statementPostingDate: input.statementPostingDate ?? null };
  if (input.mode === 'live' && input.individualTimestamp && input.notificationPostedAt) {
    const date = instantDate(input.notificationPostedAt);
    const parts = localParts(date, zone);
    const reportingDate = `${parts.year}-${parts.month}-${parts.day}`;
    const fraction = date.getUTCMilliseconds();
    const seconds = parts.second === '00' && fraction === 0 ? '' : `:${parts.second}`;
    const millis = fraction ? `.${String(fraction).padStart(3, '0')}` : '';
    return { ...base, occurredAt: date.toISOString(), reportingDate, localDateTime: `${reportingDate} ${parts.hour}:${parts.minute}${seconds}${millis}`, basis: 'notification_posted', precision: 'millisecond', inferredYear: Number(parts.year) };
  }
  if (input.mode === 'historical') {
    const date = input.bankTransactionDate ?? input.statementPostingDate;
    if (date && isGregorianDate(date)) {
      return { ...base, occurredAt: null, reportingDate: date, localDateTime: null, basis: input.bankTransactionDate ? 'bank_transaction_date' : 'statement_posting_date', precision: 'date', inferredYear: null };
    }
  }
  return { ...base, occurredAt: null, reportingDate: null, localDateTime: null, basis: 'unresolved', precision: 'unknown', inferredYear: null };
}
