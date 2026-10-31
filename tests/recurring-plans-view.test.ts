// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { RecurringPlans } from '../src/components/RecurringPlans';
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT = true;
describe('recurring plan screen', () => {
  it('shows saved plans and conservative occurrence status', async () => {
    const api = vi.fn(async (path: string) => path.includes('occurrences') ? { occurrences: [{ planId: 'p', date: '2026-10-10', status: 'not_assessable', candidateIds: [] }] } : { plans: [{ id: 'p', accountId: 'a', currency: 'CAD', merchant: 'Transit', direction: 'expense', amountMinor: 1250, frequency: 'monthly', startDate: '2026-01-10', endDate: null, enabled: true, revision: 0 }] });
    const element = document.createElement('div'); document.body.appendChild(element); const root = createRoot(element);
    await act(async () => { root.render(createElement(RecurringPlans, { api: api as never, accounts: [{id:'a',name:'Bank',currency:'CAD'}] as never, today: '2026-10-30' })); await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(element.textContent).toContain('Transit');
    expect(element.textContent).toContain('Unable to assess');
    expect(element.textContent).toContain('CAD');
    act(() => root.unmount()); element.remove();
  });
});
