import { describe, expect, it } from 'vitest';
import { projectCategoryMonths, type BudgetMonthInput } from '../src/domain/budget-projection';

const month = (value: Partial<BudgetMonthInput> & Pick<BudgetMonthInput, 'month'>): BudgetMonthInput => ({ assignedMinor: 0, activityMinor: 0, missingTransactionIds: [], ...value });

describe('budget month projection', () => {
  it('carries unspent funds and overspending into subsequent months', () => {
    expect(projectCategoryMonths([month({month:'2026-01', assignedMinor:10000, activityMinor:-4000}), month({month:'2026-02', assignedMinor:2000, activityMinor:-9000}), month({month:'2026-03', assignedMinor:3000})])).toEqual([
      {month:'2026-01', openingMinor:0, availableMinor:6000, missingTransactionIds:[]},
      {month:'2026-02', openingMinor:6000, availableMinor:-1000, missingTransactionIds:[]},
      {month:'2026-03', openingMinor:-1000, availableMinor:2000, missingTransactionIds:[]},
    ]);
  });
  it('does not invent a balance if a transaction lacks a conversion rate', () => {
    const result = projectCategoryMonths([month({month:'2026-01', assignedMinor:10000, missingTransactionIds:['tx1']}), month({month:'2026-02', assignedMinor:5000})]);
    expect(result[0]).toMatchObject({openingMinor:0, availableMinor:null, missingTransactionIds:['tx1']});
    expect(result[1]).toMatchObject({openingMinor:null, availableMinor:null});
  });
  it('requires unique ordered consecutive months and safe integers', () => {
    expect(() => projectCategoryMonths([month({month:'2026-02'}), month({month:'2026-01'})])).toThrow();
    expect(() => projectCategoryMonths([month({month:'2026-01'}), month({month:'2026-03'})])).toThrow();
    expect(() => projectCategoryMonths([month({month:'2026-13'})])).toThrow();
    expect(() => projectCategoryMonths([month({month:'2026-01', activityMinor:0.1})])).toThrow();
  });
});
