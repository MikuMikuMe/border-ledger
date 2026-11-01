/** Explicitly synthetic local-backend QA transport. Imported only by the debug fixture host. */
import type {BudgetService} from '../features/budget/budgetService';
const root='http://127.0.0.1:8793/api/budget';
type Operation={operationId:string;kind:string;status:string;updatedAt:string;resultId:null};
const operations=new Map<string,Operation>();
async function read(path:string) {
 const response=await fetch(`${root}${path}`);if(!response.ok)throw new Error('Local budget preview unavailable');return response.text();
}
function operationStatus(status:number) {if(status>=200&&status<300)return 'completed';if(status===409)return 'revision_conflict';if(status===400)return 'rejected';return 'reconciliation_required';}
export const localBudgetService:BudgetService={
 readSettings:()=>read(''),
 readModeView:(month,mode)=>read(`/view?month=${encodeURIComponent(month)}&mode=${encodeURIComponent(mode)}`),
 readCopyPreview:month=>read(`/tracking-copy?month=${encodeURIComponent(month)}`),
 readRolloverPreview:(category,month,policy)=>read(`/rollover-preview?category=${encodeURIComponent(category)}&effectiveMonth=${encodeURIComponent(month)}&policy=${encodeURIComponent(policy)}`),
 async startWrite(operationId,action,body) {
  if(!__DEV__)throw new Error('Debug fixture only');
  const deleting=action==='cash-delete',path=deleting?`cash/${encodeURIComponent((JSON.parse(body) as {id:string}).id)}`:action;
  const response=await fetch(`${root}/${path}`,{method:deleting?'DELETE':'PUT',headers:{'Content-Type':'application/json'},...(deleting?{}:{body})});
  const status=operationStatus(response.status);
  const result={operationId,kind:`budget_${action}`,status,updatedAt:new Date().toISOString(),resultId:null};operations.set(operationId,result);return result;
 },
 readOperations:async(offset,limit)=>[...operations.values()].slice(offset,offset+limit),
 queryOperation:async id=>operations.get(id)??null,
};
