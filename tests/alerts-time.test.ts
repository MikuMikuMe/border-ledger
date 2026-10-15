import { describe, expect, it } from 'vitest';
import { reportingDateForInstant, resolveEventTime } from '../src/domain/alert-lifecycle';

describe('alert time', () => {
  it('uses IANA Toronto boundaries including DST', () => {
    expect(reportingDateForInstant('2026-10-13T04:00:00.000Z', 'America/Toronto')).toBe('2026-10-13');
    expect(reportingDateForInstant('2026-10-13T03:59:59.999Z', 'America/Toronto')).toBe('2026-10-12');
    expect(resolveEventTime({ mode: 'live', notificationPostedAt: '2026-10-13T04:00:00.000Z', capturedAt: '2026-10-13T13:00:00.000Z', individualTimestamp: true, reportingZone: 'America/Toronto' })).toMatchObject({ localDateTime: '2026-10-13 00:00', basis: 'notification_posted', precision: 'millisecond' });
    expect(resolveEventTime({ mode: 'live', notificationPostedAt: '2026-10-13T03:59:59.999Z', individualTimestamp: true, reportingZone: 'America/Toronto' })).toMatchObject({ localDateTime: '2026-10-12 23:59:59.999' });
    expect(resolveEventTime({ mode: 'live', notificationPostedAt: '2026-11-02T05:00:00.000Z', individualTimestamp: true, reportingZone: 'America/Toronto' })).toMatchObject({ localDateTime: '2026-11-02 00:00' });
  });

  it('retains the original notification instant across callback, bank clock, and statement posting', () => {
    const result = resolveEventTime({ mode: 'live', notificationPostedAt: '2026-10-13T04:00:00.000Z', capturedAt: '2026-10-13T13:00:00.000Z', individualTimestamp: true, bankDisplayedTime: '2026-10-14 12:00', statementPostingDate: '2026-10-15', reportingZone: 'America/Toronto' });
    expect(result).toMatchObject({ occurredAt: '2026-10-13T04:00:00.000Z', reportingDate: '2026-10-13', localDateTime: '2026-10-13 00:00', basis: 'notification_posted', statementPostingDate: '2026-10-15' });
  });

  it('derives missing live bank year from the original notification and never lends a summary timestamp to history', () => {
    expect(resolveEventTime({ mode: 'live', notificationPostedAt: '2027-01-01T05:00:00.000Z', individualTimestamp: true, bankDisplayedTime: '12-31 23:59', reportingZone: 'America/Toronto' }).inferredYear).toBe(2027);
    expect(resolveEventTime({ mode: 'historical', notificationPostedAt: null, capturedAt: '2026-10-13T13:00:00.000Z', bankDisplayedTime: '10-12 09:00', reportingZone: 'America/Toronto' })).toMatchObject({ basis: 'unresolved', reportingDate: null, occurredAt: null });
    expect(resolveEventTime({ mode: 'live', notificationPostedAt: '2026-10-13T04:00:00.000Z', individualTimestamp: false, capturedAt: '2026-10-13T13:00:00.000Z', reportingZone: 'America/Toronto' })).toMatchObject({ basis: 'unresolved', reportingDate: null });
  });

  it('rejects impossible calendar components in live timestamps before Date normalization', () => {
    expect(() => reportingDateForInstant('2026-02-30T12:00:00Z', 'UTC')).toThrow('Invalid timestamp.');
    expect(() => resolveEventTime({ mode: 'live', notificationPostedAt: '2026-02-30T12:00:00Z', individualTimestamp: true, reportingZone: 'UTC' })).toThrow('Invalid timestamp.');
    expect(() => reportingDateForInstant('2026-02-28T12:00:00', 'UTC')).toThrow('timezone');
  });

  it('accepts valid leap-day timestamps with explicit timezone offsets', () => {
    expect(reportingDateForInstant('2024-02-29T23:30:00-05:00', 'America/Toronto')).toBe('2024-02-29');
    expect(resolveEventTime({ mode: 'live', notificationPostedAt: '2024-02-29T23:30:00-05:00', individualTimestamp: true, reportingZone: 'America/Toronto' })).toMatchObject({ occurredAt: '2024-03-01T04:30:00.000Z', reportingDate: '2024-02-29', basis: 'notification_posted' });
  });

  it('accepts real Gregorian historical dates and rejects impossible month/day combinations', () => {
    for (const date of ['2024-02-29', '2000-02-29']) {
      expect(resolveEventTime({ mode: 'historical', notificationPostedAt: null, bankTransactionDate: date })).toMatchObject({ reportingDate: date, basis: 'bank_transaction_date', precision: 'date' });
    }
    for (const date of ['2023-02-29', '1900-02-29', '2026-04-31', '2026-00-10', '2026-01-00']) {
      expect(resolveEventTime({ mode: 'historical', notificationPostedAt: null, bankTransactionDate: date })).toMatchObject({ reportingDate: null, basis: 'unresolved', precision: 'unknown' });
    }
  });
});
