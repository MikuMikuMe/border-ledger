import type { LedgerApi } from './api';
import {connectionIntent,type LunchFlowConnection} from '../../contracts/lunchflow';
export * from '../../contracts/lunchflow';
/** The closure carries the observed connection through sends, polling and completion. */
export function connectionApi(api:LedgerApi,value:LunchFlowConnection):LedgerApi {
  const intent=connectionIntent(value);
  return async<T>(path:string,init?:RequestInit):Promise<T>=>{
    if(init?.method==='POST')return api<T>(path,{...init,body:JSON.stringify({...JSON.parse(String(init.body??'{}')),...intent})});
    const url=new URL(path,'https://local.invalid');url.searchParams.set('connectionId',intent.connectionId);
    const result=await api<T>(url.pathname+url.search);
    const binding=result as {connectionId?:string;generation?:number};
    if(binding.connectionId!==intent.connectionId||binding.generation!==intent.expectedGeneration)throw new Error('This connection changed. Check connection status and choose the action again.');
    return result;
  };
}
