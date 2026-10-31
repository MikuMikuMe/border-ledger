import {describeFxRate} from './budget-fx';
import type {D1Database} from './db-types';
import type {ManualCash} from './budget-inputs';
import type {StoredBalance} from './lunchflow-balance-store';
import {warmFxSnapshot} from './ledger-reports';
import {convertMinorUnits,isFxProviderError,type ValidatedFxRates} from './fx-rates';
export type ViewDependencies={now?:()=>Date;fetcher?:typeof fetch};
export type Account={id:string;name:string;currency:string};
export interface FundingBalance {id:string;accountId?:string;name:string;source:'manual'|'lunchflow'|'unavailable'|'excluded';sourceCurrency:string;sourceMinor:number|null;amountMinor:number|null;observedAt:string|null;rateDate:string|null;rate?:string|null}
export function fundingInputs(accounts:Account[],cash:ManualCash[],synced:StoredBalance[],now:Date):FundingBalance[] {
  const overrides=new Map(cash.filter(item=>item.accountId).map(item=>[item.accountId!,item]));
  const linked=new Map(synced.map(item=>[item.accountId,item]));
  const accountItems=accounts.map(account=>accountBalance(account,overrides.get(account.id),linked.get(account.id),now));
  const eligible=new Set(accounts.map(account=>account.id));
  const excluded=cash.filter(item=>item.accountId && !eligible.has(item.accountId)).map(item=>({...manualBalance(item),source:'excluded' as const}));
  return [...accountItems,...cash.filter(item=>!item.accountId).map(item=>manualBalance(item)),...excluded];
}
function manualBalance(item:ManualCash):FundingBalance {
  return {id:item.id,...(item.accountId?{accountId:item.accountId}:{}),name:item.name,source:'manual',sourceCurrency:item.currency,sourceMinor:item.amountMinor,amountMinor:null,observedAt:null,rateDate:null};
}
function balanceIsFresh(balance:StoredBalance|undefined,now:Date):boolean {
  if(!balance || balance.stale) return false;
  const age=now.getTime()-Date.parse(balance.observedAt);
  return Number.isFinite(age) && age>=0 && age<=86400000;
}
function accountBalance(account:Account,override:ManualCash|undefined,synced:StoredBalance|undefined,now:Date):FundingBalance {
  if(override) return manualBalance(override);
  if(!synced || !balanceIsFresh(synced,now)) return {id:account.id,accountId:account.id,name:account.name,source:'unavailable',sourceCurrency:account.currency,sourceMinor:null,amountMinor:null,observedAt:synced?.observedAt??null,rateDate:null};
  return {id:account.id,accountId:account.id,name:account.name,source:'lunchflow',sourceCurrency:synced.currency,sourceMinor:synced.amountMinor,amountMinor:null,observedAt:synced.observedAt,rateDate:null};
}
function needsRate(item:FundingBalance,currency:string):boolean {
  return item.source!=='excluded' && item.sourceMinor!==null && item.sourceCurrency!==currency;
}
export async function fundingRates(db:D1Database,items:FundingBalance[],currency:string,options:{now:Date;deps:ViewDependencies}):Promise<ValidatedFxRates|null> {
  if(!items.some(item=>needsRate(item,currency))) return null;
  try {return await warmFxSnapshot(db,options.now.toISOString().slice(0,10),options.deps);}
  catch(error){if(isFxProviderError(error)) return null;throw error;}
}
function displayedRate(item:FundingBalance,currency:string,rates:ValidatedFxRates|null):string|null {
  if(item.sourceCurrency===currency || !rates) return null;
  return describeFxRate(item.sourceCurrency,currency,rates);
}
export function convertFunding(item:FundingBalance,currency:string,rates:ValidatedFxRates|null):FundingBalance {
  if(item.source==='excluded' || item.sourceMinor===null) return item;
  const same=item.sourceCurrency===currency;
  const amountMinor=same || rates ? convertMinorUnits({amountMinorUnits:item.sourceMinor,sourceCurrency:item.sourceCurrency,targetCurrency:currency,...(rates?{rates}:{})}) : null;
  return {...item,amountMinor,rateDate:same?null:rates?.effectiveDate??null,rate:displayedRate(item,currency,rates)};
}
