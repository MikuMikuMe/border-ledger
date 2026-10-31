import {describe,expect,it} from 'vitest';
import {summarizeBudget,type BudgetViewInput} from '../src/domain/budget-summary';
const base:BudgetViewInput={month:'2026-02',allocations:[],targets:[],activity:[],balances:[]};
describe('budget summary',()=>{
  it('rolls funded categories forward and computes unassigned money from cash',()=>{
    const view=summarizeBudget({...base,allocations:[{month:'2026-01',category:'Food',assignedMinor:10000},{month:'2026-02',category:'Food',assignedMinor:2000}],targets:[{category:'Food',targetMinor:12000}],activity:[{id:'a',date:'2026-01-15',category:'Food',activityMinor:-4000},{id:'b',date:'2026-02-01',category:'Food',activityMinor:-1000}],balances:[{id:'bank',amountMinor:20000},{id:'cash',amountMinor:5000}]});
    expect(view).toMatchObject({cashMinor:25000,unassignedMinor:18000,categories:[{category:'Food',openingMinor:6000,assignedMinor:2000,activityMinor:-1000,availableMinor:7000,targetMinor:12000,suggestedMinor:5000}]});
  });
  it('withholds totals when a balance or prior exchange rate is unavailable',()=>{
    const view=summarizeBudget({...base,allocations:[{month:'2026-01',category:'Food',assignedMinor:1000}],activity:[{id:'a',date:'2026-01-01',category:'Food',activityMinor:null}],balances:[{id:'bank',amountMinor:null}]});
    expect(view.cashMinor).toBeNull();expect(view.unassignedMinor).toBeNull();
    expect(view.categories[0]).toMatchObject({availableMinor:null,openingMinor:null,missingTransactionIds:['a']});
  });
  it('includes categories with spending even without explicit funding and excludes future activity',()=>{
    const view=summarizeBudget({...base,activity:[{id:'a',date:'2026-02-10',category:'Transit',activityMinor:-300},{id:'b',date:'2026-03-01',category:'Food',activityMinor:-400}],balances:[{id:'cash',amountMinor:1000}]});
    expect(view.categories).toMatchObject([{category:'Transit',availableMinor:-300}]);expect(view.unassignedMinor).toBe(1000);
  });
  it('never treats overspent category balances as cash available to assign',()=>{
    const view=summarizeBudget({...base,allocations:[{month:'2026-02',category:'Food',assignedMinor:10000}],activity:[{id:'a',date:'2026-02-10',category:'Food',activityMinor:-11000}],balances:[{id:'bank',amountMinor:0}]});
    expect(view.categories[0].availableMinor).toBe(-1000);
    expect(view.unassignedMinor).toBe(0);
  });
});
