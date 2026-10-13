import type { ReportWindow } from './types';

export type ReportingTimezone = 'America/Toronto' | 'Asia/Shanghai';
export type WeekStartsOn = 'monday' | 'sunday';

function datePartsInTimezone(now: Date, timezone: ReportingTimezone) {
  if (Number.isNaN(now.valueOf())) throw new Error('A valid reporting date is required.');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function weekDay(date: string) {
  return new Date(`${date}T12:00:00.000Z`).getUTCDay();
}

export function formatReportingDay(date: string, timezone: ReportingTimezone = 'America/Toronto') {
  return new Intl.DateTimeFormat('en-CA', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: timezone,
  }).format(new Date(`${date}T12:00:00.000Z`));
}

export function getReportWindows(
  now: Date,
  timezone: ReportingTimezone = 'America/Toronto',
  weekStartsOn: WeekStartsOn = 'monday',
): ReportWindow[] {
  const today = datePartsInTimezone(now, timezone);
  const startDay = weekStartsOn === 'sunday' ? 0 : 1;
  const daysSinceStart = (weekDay(today) - startDay + 7) % 7;
  const weekStart = shiftDate(today, -daysSinceStart);
  const monthStart = `${today.slice(0, 7)}-01`;

  return [
    { key: 'today', label: 'Today', start: today, end: today },
    { key: 'week', label: 'This week', start: weekStart, end: today },
    { key: 'month', label: 'This month', start: monthStart, end: today },
  ];
}
