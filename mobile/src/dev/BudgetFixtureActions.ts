import type {BudgetData} from '../features/budget/BudgetContent';
type FixtureInput={category?:string;assignedMinor?:number;targetMinor?:number;from?:string;to?:string;amountMinor?:number;name?:string;currency?:string;accountId?:string;id?:string};
type Sharing={current:boolean};
export async function fixtureAnalysis(sharing:Sharing,action:string,body:string):Promise<string> {
  const input=JSON.parse(body) as {enabled?:boolean;provider?:string;from?:string;to?:string;detail?:boolean;mode?:string};
  if(action==='settings')return JSON.stringify({configurations:[{provider:'openai',model:'sample-model'}],detailedTransactions:sharing.current});
  if(action==='sharing'){sharing.current=input.enabled===true;return JSON.stringify({ok:true});}
  if(action==='preview')return JSON.stringify({...input,endpoint:'https://api.openai.com/v1/chat/completions',model:'sample-model',configurationRevision:'synthetic-revision'});
  if(action==='run')return JSON.stringify({analysis:'Your category funding covers this period.'});
  return JSON.stringify({ok:true});
}
function fixtureTransfer(current:BudgetData,input:FixtureInput):BudgetData {
  return {...current,summary:{...current.summary,categories:current.summary.categories.map(row=>{const change=row.category===input.from?-input.amountMinor!:row.category===input.to?input.amountMinor!:0;return {...row,assignedMinor:row.assignedMinor+change,availableMinor:(row.availableMinor??0)+change};})}};
}
function fixtureCash(current:BudgetData,input:FixtureInput):BudgetData {
  return {...current,balances:[...current.balances.filter(row=>input.accountId?row.accountId!==input.accountId:row.id!==input.id),{id:input.id!,...(input.accountId?{accountId:input.accountId}:{}),name:input.name!,source:'manual',sourceCurrency:input.currency!,sourceMinor:input.amountMinor!,amountMinor:input.amountMinor!,rateDate:null,observedAt:null}]};
}
export function fixtureWrite(current:BudgetData,action:string,input:FixtureInput):BudgetData {
  if(action==='allocations')return {...current,summary:{...current.summary,categories:current.summary.categories.map(row=>row.category===input.category?{...row,assignedMinor:input.assignedMinor!,availableMinor:(row.openingMinor??0)+input.assignedMinor!+(row.activityMinor??0)}:row)}};
  if(action==='targets')return {...current,summary:{...current.summary,categories:current.summary.categories.map(row=>row.category===input.category?{...row,targetMinor:input.targetMinor!}:row)}};
  if(action==='transfers')return fixtureTransfer(current,input);
  if(action==='cash')return fixtureCash(current,input);
  if(action==='cash-delete')return {...current,balances:current.balances.filter(row=>row.id!==input.id)};
  return current;
}
