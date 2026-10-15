import { describe, expect, it } from 'vitest';
import { mapApiReport, reportRequestPath } from '../src/App';

const reportWindow = {
  key: 'month' as const,
  label: 'This month',
  start: '2026-10-01',
  end: '2026-10-14',
};

const completeReport = {
  ledgerId: 'personal',
  asOf: '2026-10-14T12:00:00.000Z',
  timeBasis: 'accounting_date',
  timeZone: 'America/Toronto',
  from: '2026-10-01',
  to: '2026-10-14',
  includeProvisional: false,
  currencyTotals: [{ currency: 'USD', confirmedMinorUnits: 12500, provisionalMinorUnits: 250, confirmedCount: 2, provisionalCount: 1 }],
  dailyTotals: [{ date: '2026-10-10', currency: 'USD', confirmedMinorUnits: 12500, provisionalMinorUnits: 250 }],
  reportingCurrency: 'CAD',
  convertedTotals: { confirmedMinorUnits: 17000, provisionalMinorUnits: 300, confirmedCount: 2, provisionalCount: 1 },
  convertedDailyTotals: [{ date: '2026-10-10', confirmedMinorUnits: 17000, provisionalMinorUnits: 300 }],
  fx: {
    provider: 'frankfurter',
    complete: false,
    unavailableSourceCurrencies: ['JPY'],
    lockedDateCount: 2,
    observedDateRange: { earliest: '2026-10-09', latest: '2026-10-14' },
    chineseBankBand: {
      eligible: true,
      currency: 'CAD',
      baseMinorUnits: 10000,
      lowerMinorUnits: 9850,
      upperMinorUnits: 10150,
      percentageBasisPoints: 150,
    },
  },
  reviewCount: 0,
  excludedCount: 0,
  sourceCoverage: { statement: 1 },
};

describe('web reporting contract mapping', () => {
  it('maps converted totals, daily totals, partial FX metadata, and the server band', () => {
    const mapped = mapApiReport(completeReport);

    expect(mapped).toMatchObject({
      reportingCurrency: 'CAD',
      convertedTotals: {
        confirmedMinorUnits: 17000,
        provisionalMinorUnits: 300,
        confirmedCount: 2,
        provisionalCount: 1,
      },
      convertedDailyTotals: [{ date: '2026-10-10', confirmedMinorUnits: 17000, provisionalMinorUnits: 300 }],
      fx: {
        provider: 'frankfurter',
        complete: false,
        unavailableSourceCurrencies: ['JPY'],
        lockedDateCount: 2,
        observedDateRange: { earliest: '2026-10-09', latest: '2026-10-14' },
        chineseBankBand: {
          eligible: true,
          currency: 'CAD',
          baseMinorUnits: 10000,
          lowerMinorUnits: 9850,
          upperMinorUnits: 10150,
          percentageBasisPoints: 150,
        },
      },
    });
  });

  it('rejects unsafe additive monetary, count, and band integers', () => {
    expect(mapApiReport({
      ...completeReport,
      convertedTotals: { ...completeReport.convertedTotals, confirmedMinorUnits: Number.MAX_SAFE_INTEGER + 1 },
    })).toBeNull();

    expect(mapApiReport({
      ...completeReport,
      fx: { ...completeReport.fx, lockedDateCount: Number.MAX_SAFE_INTEGER + 1 },
    })).toBeNull();

    expect(mapApiReport({
      ...completeReport,
      fx: {
        ...completeReport.fx,
        chineseBankBand: { ...completeReport.fx.chineseBankBand, upperMinorUnits: Number.MAX_SAFE_INTEGER + 1 },
      },
    })).toBeNull();
  });

  it('sends a selected reporting target while leaving the source filter absent', () => {
    const target = new URL(reportRequestPath(reportWindow, true, 'America/Toronto', 'CAD'), 'https://ledger.example.test');
    expect(target.searchParams.get('reportingCurrency')).toBe('CAD');
    expect(target.searchParams.get('includeProvisional')).toBe('true');
    expect(target.searchParams.has('currency')).toBe(false);

    const sourcePreserving = new URL(reportRequestPath(reportWindow, false, 'America/Toronto', null), 'https://ledger.example.test');
    expect(sourcePreserving.searchParams.has('reportingCurrency')).toBe(false);
    expect(sourcePreserving.searchParams.has('currency')).toBe(false);
  });
});
