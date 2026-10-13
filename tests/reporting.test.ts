import { describe, expect, it } from 'vitest';
import { getReportWindows } from '../src/domain/reporting';

describe('reporting windows', () => {
  it('uses the configured Toronto calendar for today, week, and month', () => {
    const windows = getReportWindows(new Date('2026-10-13T16:00:00.000Z'), 'America/Toronto', 'monday');

    expect(windows).toEqual([
      { key: 'today', label: 'Today', start: '2026-10-13', end: '2026-10-13' },
      { key: 'week', label: 'This week', start: '2026-10-12', end: '2026-10-13' },
      { key: 'month', label: 'This month', start: '2026-10-01', end: '2026-10-13' },
    ]);
  });

  it('keeps timezone midnight boundaries in the selected zone', () => {
    const instant = new Date('2026-10-13T03:30:00.000Z');

    expect(getReportWindows(instant, 'America/Toronto', 'monday')[0].end).toBe('2026-10-12');
    expect(getReportWindows(instant, 'Asia/Shanghai', 'monday')[0].end).toBe('2026-10-13');
  });

  it('supports Sunday week starts and DST calendar changes', () => {
    const sunday = getReportWindows(new Date('2026-10-18T15:00:00.000Z'), 'America/Toronto', 'sunday');
    expect(sunday[1]).toMatchObject({ start: '2026-10-18', end: '2026-10-18' });

    const beforeSpringForward = getReportWindows(new Date('2026-03-08T06:30:00.000Z'), 'America/Toronto', 'monday');
    const afterSpringForward = getReportWindows(new Date('2026-03-08T07:30:00.000Z'), 'America/Toronto', 'monday');
    expect(beforeSpringForward[0].end).toBe('2026-03-08');
    expect(afterSpringForward[0].end).toBe('2026-03-08');
    expect(afterSpringForward[1].start).toBe('2026-03-02');
  });
});
