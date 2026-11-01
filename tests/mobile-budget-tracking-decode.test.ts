import {expect,it} from 'vitest';
import {decodeBudgetView} from '../mobile/src/features/budget/decodeBudget';
const view={mode:'tracking',settings:{currency:'CAD',startMonth:'2026-10',preferredMode:'tracking',revision:4},summary:{month:'2026-10',plannedIncomeMinor:300000,plannedExpenseMinor:100000,plannedSavingsMinor:200000,actualIncomeMinor:200000,actualExpenseMinor:null,actualSavingsMinor:null,categories:[{direction:'expense',category:'Food',plannedMinor:100000,actualMinor:null,varianceMinor:null,missingTransactionIds:['fx']}]},plans:[{month:'2026-10',direction:'expense',category:'Food',plannedMinor:100000}],activity:[],currentMonth:'2026-10',asOf:'2026-10-31T12:00:00Z'};
it('decodes tracking without pretending its unknown actuals are envelope cash',()=>{
 const data=decodeBudgetView(JSON.stringify(view));expect(data.mode).toBe('tracking');expect(data.summary).toMatchObject({actualExpenseMinor:null,plannedSavingsMinor:200000});
});
it('rejects negative forecasts and invalid tracking directions',()=>{
 expect(()=>decodeBudgetView(JSON.stringify({...view,plans:[{...view.plans[0],plannedMinor:-1}]}))).toThrow();
 expect(()=>decodeBudgetView(JSON.stringify({...view,summary:{...view.summary,categories:[{...view.summary.categories[0],direction:'transfer'}]}}))).toThrow();
});
