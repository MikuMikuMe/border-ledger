import React,{useEffect,useRef,useState} from 'react';
import {View} from 'react-native';
import NativeLedger from '../../native/specs/NativeLedger';
import NativeSession from '../../native/specs/NativeSession';
import {Action,Card,Copy,DetailModal} from './FinanceViews';
import {ManualEntryForm,type ManualDraft} from './ManualEntryForm';
import {formatMoney} from './model';
import type {FinanceController} from './FinanceController';
import type {Snapshot} from './contracts';

type Account=Snapshot['accounts'][number];
type Match={manualId:string;bankId:string;accountId:string;manualDate:string;bankDate:string;manualMerchant:string;bankMerchant:string;amountMinor:number;currency:string;bankAmountMinor?:number;bankCurrency?:string;category:string;note:string|null;decision:'open'|'confirmed'|'dismissed'|'stale';revision:number};
const matchStatus={open:'Needs review',confirmed:'Duplicate confirmed',dismissed:'Not a duplicate',stale:'Bank entry changed; both records count'};
function today(){const date=new Date();return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,10);}
function initial(accounts:Account[]):ManualDraft{return {accountId:accounts[0]?.id??'',date:today(),merchant:'',amount:'',currency:accounts[0]?.currencies[0]??'',kind:'expense',direction:'out',category:'',note:''};}
async function readMatches() {
  const all:Match[]=[];let page:Match[];
  do {const data=JSON.parse(await NativeLedger.readManualMatches(all.length)) as {matches:Match[]};if(!Array.isArray(data.matches))throw new Error('Invalid match response');page=data.matches;all.push(...page);}while(page.length===200);
  return all;
}
async function pendingManualOperation() {
  let offset=0,found:string|null=null,page:Awaited<ReturnType<typeof NativeSession.readOperations>>;
  do {page=await NativeSession.readOperations({offset,limit:100});found??=page.find(item=>item.kind.startsWith('manual_')&&!['completed','rejected','revision_conflict','failed_local','canceled'].includes(item.status))?.operationId??null;offset+=page.length;} while(page.length===100);
  return found;
}
function accountName(accounts:Account[],id:string) { const account=accounts.find(item=>item.id===id); return account?[account.institution,account.displayName].filter(Boolean).join(' · '):'Account unavailable'; }
function bankAmount(match:Match) { return match.bankAmountMinor!==undefined && match.bankCurrency?` · ${formatMoney(String(match.bankAmountMinor),match.bankCurrency)}`:''; }
function MatchList({dark,accounts,matches,blocked,onDecide}:{dark:boolean;accounts:Account[];matches:Match[];blocked:boolean;onDecide(match:Match,decision:'confirmed'|'dismissed'):void}) {
  if(!matches.length)return null;
  return <><Copy dark={dark} heading>Possible duplicates</Copy><Copy dark={dark}>Both entries count until you confirm a duplicate. The bank entry is kept in totals.</Copy>{matches.map(match=><View key={`${match.manualId}:${match.bankId}`} style={{gap:6,marginTop:12}}>
    <Copy dark={dark}>{accountName(accounts,match.accountId)}</Copy>
    <Copy dark={dark}>Manual: {match.manualDate} · {match.manualMerchant} · {formatMoney(String(match.amountMinor),match.currency)}</Copy>
    <Copy dark={dark}>Bank: {match.bankDate} · {match.bankMerchant}{bankAmount(match)} · {matchStatus[match.decision]}</Copy>
    <Copy dark={dark}>Category: {match.category}{match.note?` · ${match.note}`:''}</Copy>
    {match.decision!=='confirmed'&&match.decision!=='stale'?<Action dark={dark} label="Confirm duplicate" disabled={blocked} onPress={()=>onDecide(match,'confirmed')}/>:null}
    {match.decision!=='dismissed'?<Action dark={dark} label={match.decision==='confirmed'?'Undo confirmation':'Not a duplicate'} disabled={blocked} onPress={()=>onDecide(match,'dismissed')}/>:null}
  </View>)}</>;
}
async function loadManualStatus(setMatches:(matches:Match[])=>void,setPending:(pending:string|null)=>void,setMessage:(message:string)=>void) {
  try {setMatches(await readMatches());}catch{setMessage('Could not load possible duplicates.');}
  try {setPending(await pendingManualOperation());}catch{setMessage('Could not check submitted manual changes.');}
}
async function resumeManualOperation(pending:string|null,controller:FinanceController,load:()=>Promise<void>,setMessage:(message:string)=>void) {
  if(!pending)return;
  try{const result=await NativeLedger.resumeManualWrite(pending);await controller.recover();await Promise.all([controller.reload(),load()]);setMessage(result.status==='completed'?'Submitted change saved.':'The submitted change still needs review.');}catch{setMessage('Could not check the submitted change. Try again when connected.');}
}
async function writeManualOperation(action:'create'|'match',body:Record<string,unknown>,id:string,controller:FinanceController,load:()=>Promise<void>,setMessage:(message:string)=>void,setOpen:(open:boolean)=>void) {
    setMessage('');await controller.mutation.submit(id,()=>NativeLedger.startManualWrite(id,action,JSON.stringify(body)),key=>NativeSession.queryOperation({operationId:key}));
    if(controller.mutation.current().status==='completed'){setOpen(false);await Promise.all([controller.reload(),load()]);setMessage(action==='create'?'Transaction saved.':'Duplicate decision saved.');}
}
function ManualStatus({dark,message,pending,matches,accounts,blocked,onRefresh,onResume,onDecide}:{dark:boolean;message:string;pending:string|null;matches:Match[];accounts:Account[];blocked:boolean;onRefresh():void;onResume():void;onDecide(match:Match,decision:'confirmed'|'dismissed'):void}) {
  if(![message,pending,matches.length].some(Boolean))return null;
  return <Card dark={dark}>
    {message?<Copy dark={dark}>{message}</Copy>:null}
    {message?<Action dark={dark} label="Refresh manual transaction status" onPress={onRefresh}/>:null}
    {pending?<Action dark={dark} label="Retry submitted manual change" onPress={onResume}/>:null}
    <MatchList dark={dark} accounts={accounts} matches={matches} blocked={blocked} onDecide={onDecide}/>
  </Card>;
}
function AccountStatus({dark,snapshot,onRetry,onClose}:{dark:boolean;snapshot:ReturnType<FinanceController['snapshot']['current']>;onRetry():void;onClose():void}) {
  const loading=snapshot.phase==='loading',empty=snapshot.phase==='ready'&&snapshot.data?.accounts.length===0;
  return <DetailModal dark={dark} title="Add transaction" onClose={onClose}>
    <Copy dark={dark}>{loading?'Loading accounts…':empty?'Add an account before recording a transaction.':'Accounts are unavailable. Refresh and try again.'}</Copy>
    {!loading&&!empty?<Action dark={dark} label="Refresh accounts" onPress={onRetry}/>:null}
    <Action dark={dark} label="Close" onPress={onClose}/>
  </DetailModal>;
}
function needsDraft(open:boolean,draft:ManualDraft,accounts:Account[]){return open&&!draft.accountId&&accounts.length>0;}
export function ManualTransactions({dark,controller,operationId,manualRequest}:{dark:boolean;controller:FinanceController;operationId:()=>string;manualRequest:number}){
  const snapshot=controller.snapshot.current(), accounts=snapshot.data?.accounts??[];
  const lastRequest=useRef(manualRequest);
  const [draft,setDraft]=useState<ManualDraft>(()=>initial(accounts)),[open,setOpen]=useState(false),[matches,setMatches]=useState<Match[]>([]),[message,setMessage]=useState(''),[pending,setPending]=useState<string|null>(null);
  useEffect(()=>{if(lastRequest.current!==manualRequest){lastRequest.current=manualRequest;setDraft(initial(accounts));setOpen(true);}},[manualRequest]);
  useEffect(()=>{if(needsDraft(open,draft,accounts))setDraft(initial(accounts));},[open,accounts,draft.accountId]);
  const mutation=controller.mutation.current();
  const load=()=>loadManualStatus(setMatches,setPending,setMessage);
  useEffect(()=>{void load();const subscription=NativeLedger.onChanged(()=>{void load();});return()=>subscription.remove();},[]);
  const write=(action:'create'|'match',body:Record<string,unknown>,id:string)=>writeManualOperation(action,body,id,controller,load,setMessage,setOpen);
  const create=()=>{const id=operationId();void write('create',{...draft,requestId:id,note:draft.note.trim()||null},id);};
  const decide=(match:Match,decision:'confirmed'|'dismissed')=>{const id=operationId();void write('match',{manualId:match.manualId,bankId:match.bankId,decision,expectedRevision:match.revision},id);};
  const resume=()=>resumeManualOperation(pending,controller,load,setMessage);
  const formReady=open&&accounts.some(account=>account.id===draft.accountId);
  return <>
    <ManualStatus dark={dark} message={message} pending={pending} matches={matches} accounts={accounts} blocked={mutation.blocked} onRefresh={()=>{setMessage('');void load();}} onResume={()=>{void resume();}} onDecide={decide}/>
    {formReady?<ManualEntryForm dark={dark} accounts={accounts} draft={draft} onDraft={setDraft} mutation={mutation} onSave={create} onClose={()=>setOpen(false)}/>:null}
    {open&&!formReady?<AccountStatus dark={dark} snapshot={snapshot} onRetry={()=>{void controller.reload();}} onClose={()=>setOpen(false)}/>:null}
  </>;
}