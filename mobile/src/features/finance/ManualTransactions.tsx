import React,{useEffect,useState} from 'react';
import {View} from 'react-native';
import NativeLedger from '../../native/specs/NativeLedger';
import NativeSession from '../../native/specs/NativeSession';
import {Action,Card,Copy} from './FinanceViews';
import {ManualEntryForm,type ManualDraft} from './ManualEntryForm';
import {formatMoney} from './model';
import type {FinanceController} from './FinanceController';
import type {Snapshot} from './contracts';

type Account=Snapshot['accounts'][number];
type Match={manualId:string;bankId:string;manualDate:string;bankDate:string;manualMerchant:string;bankMerchant:string;amountMinor:number;currency:string;category:string;note:string|null;decision:'open'|'confirmed'|'dismissed'|'stale';revision:number};
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
function MatchList({dark,matches,blocked,onDecide}:{dark:boolean;matches:Match[];blocked:boolean;onDecide(match:Match,decision:'confirmed'|'dismissed'):void}) {
  if(!matches.length)return null;
  return <><Copy dark={dark} heading>Possible duplicates</Copy><Copy dark={dark}>Both entries count until you confirm a duplicate. The bank entry is kept in totals.</Copy>{matches.map(match=><View key={`${match.manualId}:${match.bankId}`} style={{gap:6,marginTop:12}}>
    <Copy dark={dark}>Manual: {match.manualDate} · {match.manualMerchant} · {formatMoney(String(match.amountMinor),match.currency)}</Copy>
    <Copy dark={dark}>Bank: {match.bankDate} · {match.bankMerchant} · {match.decision==='stale'?'Bank entry changed; both records count':match.decision}</Copy>
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
export function ManualTransactions({dark,controller,operationId}:{dark:boolean;controller:FinanceController;operationId:()=>string}){
  const accounts=controller.snapshot.current().data?.accounts??[];
  const [draft,setDraft]=useState<ManualDraft>(()=>initial(accounts)),[open,setOpen]=useState(false),[matches,setMatches]=useState<Match[]>([]),[message,setMessage]=useState(''),[pending,setPending]=useState<string|null>(null);
  const mutation=controller.mutation.current();
  const load=()=>loadManualStatus(setMatches,setPending,setMessage);
  useEffect(()=>{void load();const subscription=NativeLedger.onChanged(()=>{void load();});return()=>subscription.remove();},[]);
  const write=(action:'create'|'match',body:Record<string,unknown>,id:string)=>writeManualOperation(action,body,id,controller,load,setMessage,setOpen);
  const create=()=>{const id=operationId();void write('create',{...draft,requestId:id,note:draft.note.trim()||null},id);};
  const decide=(match:Match,decision:'confirmed'|'dismissed')=>{const id=operationId();void write('match',{manualId:match.manualId,bankId:match.bankId,decision,expectedRevision:match.revision},id);};
  const resume=()=>resumeManualOperation(pending,controller,load,setMessage);
  return <Card dark={dark}>
    <Copy dark={dark} heading>Manual transactions</Copy>
    <Action dark={dark} label="Add transaction" disabled={!accounts.length||mutation.blocked} onPress={()=>{setDraft(initial(accounts));setOpen(true);}}/>
    {!accounts.length?<Copy dark={dark}>Add an account before recording a transaction.</Copy>:null}
    {message?<Copy dark={dark}>{message}</Copy>:null}
    {message?<Action dark={dark} label="Refresh manual transaction status" onPress={()=>{setMessage('');void load();}}/>:null}
    {pending?<Action dark={dark} label="Retry submitted manual change" onPress={()=>{void resume();}}/>:null}
    <MatchList dark={dark} matches={matches} blocked={mutation.blocked} onDecide={decide}/>
    {open?<ManualEntryForm dark={dark} accounts={accounts} draft={draft} onDraft={setDraft} mutation={mutation} onSave={create} onClose={()=>setOpen(false)}/>:null}
  </Card>;
}
