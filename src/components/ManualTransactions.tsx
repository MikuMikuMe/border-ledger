import { useEffect, useState, type Dispatch, type SetStateAction, type FormEvent } from 'react';
import type { LedgerApi } from '../domain/api';
import { LedgerApiError, ledgerSession } from '../domain/api';
import { formatMoney } from '../domain/format';
import { getCurrencyMeta, parseMoneyMinor } from '../domain/currencies';

type Account = {id:string;name:string;institution:string;currency:string;currencies?:string[]};
type Match = {manualId:string;bankId:string;manualDate:string;bankDate:string;manualMerchant:string;bankMerchant:string;amountMinor:number;currency:string;category:string;note:string|null;decision:'open'|'confirmed'|'dismissed'|'stale';revision:number};
type Entry = {requestId:string;accountId:string;date:string;merchant:string;amount:string;currency:string;kind:string;direction:string;category:string;note:string};

export function parseAccountCurrencies(value: unknown, fallback: string): string[] {
  try {
    const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) && parsed.length ? parsed.filter((code): code is string => typeof code === 'string' && !!getCurrencyMeta(code)) : [fallback];
  } catch { return [fallback]; }
}

function today() { const now = new Date(); return new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10); }
function newEntry(accounts:Account[]):Entry { return {requestId:crypto.randomUUID(),accountId:accounts[0]?.id??'',date:today(),merchant:'',amount:'',currency:accounts[0]?.currency??'',kind:'expense',direction:'out',category:'',note:''}; }
async function readMatches(api:LedgerApi) {
  const all:Match[]=[];let page:Match[];
  do {const data=await api<{matches:Match[]}>(`/api/transactions/manual-matches?offset=${all.length}`);if(!Array.isArray(data.matches))throw new Error('Invalid match response');page=data.matches;all.push(...page);} while(page.length===200);
  return all;
}

function MatchList({matches,busy,onDecide}:{matches:Match[];busy:boolean;onDecide(match:Match,decision:'confirmed'|'dismissed'):void}) {
  if(!matches.length)return null;
  return <div><h3>Possible duplicates</h3><p>Both entries count until you confirm a duplicate. The bank entry is kept in totals.</p>{matches.map(match=><div className="manual-match" key={`${match.manualId}:${match.bankId}`}><p><strong>Manual:</strong> {match.manualDate} · {match.manualMerchant} · {formatMoney(Math.abs(match.amountMinor),match.currency)}<br/><strong>Bank:</strong> {match.bankDate} · {match.bankMerchant}<br/>Category: {match.category}{match.note?` · ${match.note}`:''} · {match.decision==='stale'?'Bank entry changed; both records count':match.decision}</p><div className="manual-actions">{match.decision!=='confirmed'&&match.decision!=='stale'?<button type="button" className="outline-button" disabled={busy} onClick={()=>onDecide(match,'confirmed')}>Confirm duplicate</button>:null}{match.decision!=='dismissed'?<button type="button" className="outline-button" disabled={busy} onClick={()=>onDecide(match,'dismissed')}>{match.decision==='confirmed'?'Undo confirmation':'Not a duplicate'}</button>:null}</div></div>)}</div>;
}

function EntryForm({accounts,entry,setEntry,busy,uncertain,onSubmit,onCancel}:{accounts:Account[];entry:Entry;setEntry:Dispatch<SetStateAction<Entry>>;busy:boolean;uncertain:boolean;onSubmit(event:FormEvent):Promise<void>;onCancel():void}) {
  const selected=accounts.find(account=>account.id===entry.accountId);
  const update=(name:keyof Entry,value:string)=>setEntry(current=>({...current,[name]:value}));
  return <form onSubmit={event=>{void onSubmit(event);}} className="manual-form"><fieldset disabled={busy||uncertain}>
      <label>Account<select required value={entry.accountId} onChange={event=>{const account=accounts.find(item=>item.id===event.target.value);setEntry(current=>({...current,accountId:event.target.value,currency:account?.currency??''}));}}>{accounts.map(account=><option key={account.id} value={account.id}>{account.institution} · {account.name}</option>)}</select></label>
      <label>Date<input type="date" required value={entry.date} onChange={event=>update('date',event.target.value)}/></label>
      <label>Description<input required maxLength={160} value={entry.merchant} onChange={event=>update('merchant',event.target.value)}/></label>
      <label>Amount<input required inputMode="decimal" value={entry.amount} onChange={event=>update('amount',event.target.value)}/></label>
      <label>Currency<select value={entry.currency} onChange={event=>update('currency',event.target.value)}>{(selected?.currencies?.length?selected.currencies:[selected?.currency??'']).map(code=><option key={code}>{code}</option>)}</select></label>
      <label>Type<select value={entry.kind} onChange={event=>update('kind',event.target.value)}>{['expense','income','transfer','refund','fee'].map(kind=><option key={kind} value={kind}>{kind}</option>)}</select></label>
      {entry.kind==='transfer'?<label>Direction<select value={entry.direction} onChange={event=>update('direction',event.target.value)}><option value="out">Out of account</option><option value="in">Into account</option></select></label>:null}
      <label>Category<input required maxLength={80} value={entry.category} onChange={event=>update('category',event.target.value)}/></label>
      <label>Note (optional)<input maxLength={1000} value={entry.note} onChange={event=>update('note',event.target.value)}/></label>
    </fieldset><div className="manual-actions"><button type="submit" className="primary-button" disabled={busy}>{busy?'Saving…':uncertain?'Retry same entry':'Save transaction'}</button>{!uncertain?<button type="button" className="quiet-button" disabled={busy} onClick={onCancel}>Cancel</button>:null}</div></form>;
}

type EntryActions = {entry:Entry;pendingKey:string|null;api:LedgerApi;onChanged:()=>Promise<void>;loadMatches:()=>Promise<void>;setBusy:Dispatch<SetStateAction<boolean>>;setMessage:Dispatch<SetStateAction<string>>;setOpen:Dispatch<SetStateAction<boolean>>;setUncertain:Dispatch<SetStateAction<boolean>>};
function validEntryAmount(entry:Entry) {
  try { return parseMoneyMinor(entry.amount.trim(),entry.currency)>0; }
  catch { return false; }
}
function saveRejected(error:unknown): error is LedgerApiError {
  return error instanceof LedgerApiError && error.status>=400 && error.status<500 && error.code!=='session_changed';
}
function storePendingEntry(pendingKey:string|null,entry:Entry) {
  if(pendingKey)sessionStorage.setItem(pendingKey,JSON.stringify(entry));
}
function clearPendingEntry(pendingKey:string|null) {
  if(pendingKey)sessionStorage.removeItem(pendingKey);
}
async function submitEntry(event:FormEvent,{entry,pendingKey,api,onChanged,loadMatches,setBusy,setMessage,setOpen,setUncertain}:EntryActions) {
    event.preventDefault();
    if(!validEntryAmount(entry)){setMessage('Enter a positive amount with the correct decimal places for the currency.');return;}
    setBusy(true);setMessage('');
    try {
      storePendingEntry(pendingKey,entry);
      await api('/api/transactions',{method:'POST',body:JSON.stringify({...entry,note:entry.note.trim()||null})});
      clearPendingEntry(pendingKey);
      setOpen(false);setUncertain(false);setMessage('Transaction saved.');
      await Promise.all([onChanged(),loadMatches()]).catch(()=>setMessage('Transaction saved, but refresh failed. Refresh to see the latest activity.'));
    } catch(error) {
      const rejected=saveRejected(error);
      if(rejected)clearPendingEntry(pendingKey);
      setUncertain(!rejected);setMessage(rejected ? error.message : 'Save status is unknown. Retry this same entry to check safely.');
    } finally {setBusy(false);}
}
async function decideMatch(match:Match,decision:'confirmed'|'dismissed',{api,onChanged,loadMatches,setBusy,setMessage}:EntryActions) {
    setBusy(true);setMessage('');try {
      await api('/api/transactions/manual-matches',{method:'POST',body:JSON.stringify({manualId:match.manualId,bankId:match.bankId,decision,expectedRevision:match.revision})});
      await Promise.all([onChanged(),loadMatches()]);setMessage(decision==='confirmed'?'Duplicate confirmed.':'Match dismissed.');
    } catch {setMessage('Could not update the match. Refresh and try again.');await loadMatches();} finally {setBusy(false);}
}

function restorePendingEntry(pendingKey:string|null,{setEntry,setOpen,setUncertain,setMessage}:{setEntry:Dispatch<SetStateAction<Entry>>;setOpen:Dispatch<SetStateAction<boolean>>;setUncertain:Dispatch<SetStateAction<boolean>>;setMessage:Dispatch<SetStateAction<string>>}) {
  if(!pendingKey)return;
  try{const saved=sessionStorage.getItem(pendingKey);if(saved){setEntry(JSON.parse(saved) as Entry);setOpen(true);setUncertain(true);setMessage('A previous save is unresolved. Retry this same entry to check safely.');}}catch{setMessage('Could not restore the previous manual entry.');}
}

export function ManualTransactions({accounts,api,onChanged}:{accounts:Account[];api:LedgerApi;onChanged:()=>Promise<void>}) {
  const [entry,setEntry]=useState(()=>newEntry(accounts));
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false);
  const [message,setMessage]=useState('');
  const [matches,setMatches]=useState<Match[]>([]);
  const ledgerId=ledgerSession.snapshot().identity?.ledgerId;
  const pendingKey=ledgerId?`manual-pending:${ledgerId}`:null;
  const loadMatches=async()=>{try {setMatches(await readMatches(api));}catch {setMessage('Could not load possible duplicates.');}};
  useEffect(()=>{void loadMatches();},[]);
  useEffect(()=>{restorePendingEntry(pendingKey,{setEntry,setOpen,setUncertain,setMessage});},[pendingKey]);
  const start=()=>{setEntry(newEntry(accounts));setMessage('');setUncertain(false);setOpen(true);};
  const actions={entry,pendingKey,api,onChanged,loadMatches,setBusy,setMessage,setOpen,setUncertain};
  const submit=(event:FormEvent)=>submitEntry(event,actions);
  const decide=(match:Match,decision:'confirmed'|'dismissed')=>decideMatch(match,decision,actions);
  return <section className="panel manual-transactions" aria-label="Manual transactions">
    <div className="section-heading"><div><h2>Manual transactions</h2><p>Add one transaction or review possible duplicates.</p></div>{!open?<button type="button" className="outline-button" disabled={!accounts.length} onClick={start}>Add transaction</button>:null}</div>
    {!accounts.length?<p>Add an account before recording a transaction.</p>:null}
    {message?<p role="status">{message}</p>:null}
    {open?<EntryForm accounts={accounts} entry={entry} setEntry={setEntry} busy={busy} uncertain={uncertain} onSubmit={submit} onCancel={()=>setOpen(false)}/>:null}
    <MatchList matches={matches} busy={busy} onDecide={(match,decision)=>{void decide(match,decision);}}/>
  </section>;
}
