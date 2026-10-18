import React,{useEffect,useState} from 'react';
import {Pressable,StyleSheet,Text,TextInput,View} from 'react-native';
import {Action,Card,Copy,DetailModal,MutationStatus,Status} from '../finance/FinanceViews';
import {formatMoney,type LoadState} from '../finance/model';
import type {MutationState} from '../finance/contracts';
import type {Account,AccountsData,Alert,Connection,Detail,ReviewPage} from './contracts';
import {reviewDisabledReason} from './DetailsController';
type Theme={dark:boolean};
type Base=Theme&{mutation:MutationState;onRetry():void;onLoadMore():void};
const classes=['unclassified','subscription','bill','other','excluded'];
const money=(value:{currency:string;amountMinor:string}|null)=>value?`${value.currency} · ${formatMoney(value.amountMinor,value.currency)}`:'unavailable';

export function RecurringDetailView({dark,state,mutation,onRetry,onLoadMore,onClose,onClassify}:Base&{state:LoadState<Detail>;onClose():void;onClassify(value:string):void}) {
  const detail=state.data,s=detail?.stream,disabled=state.phase!=='ready'||mutation.blocked||mutation.status==='revision_conflict';
  return <DetailModal dark={dark} title="Recurring detail" onClose={onClose}>
    <Status dark={dark} state={state} label="recurring detail" onRetry={onRetry}/>
    {s?<><Copy dark={dark} heading>{s.merchantName??'Merchant unavailable'}</Copy><Copy dark={dark}>{s.currency} · {s.frequency} · Source {s.sourceStatus} · Revision {s.revision}</Copy>
      <Copy dark={dark}>Account: {s.accountId} · {s.isOutflow?'Outflow':'Inflow'}</Copy><Copy dark={dark}>Source frequency: {s.sourceFrequency??'unavailable'} · Source updated {s.sourceUpdatedAt??'unavailable'}</Copy>
      <Copy dark={dark}>First {s.firstDate??'unavailable'} · Latest {s.lastDate??'unavailable'}</Copy>
      <Copy dark={dark}>Average: {s.averageAmountMinor===null?'unavailable':money({currency:s.currency,amountMinor:s.averageAmountMinor})}</Copy>
      <Copy dark={dark}>Last: {s.lastAmountMinor===null?'unavailable':money({currency:s.currency,amountMinor:s.lastAmountMinor})}</Copy>
      <Copy dark={dark}>Next expected: {s.predictedNextDate??'unavailable'} · {s.predictedAmountMinor===null?'unavailable':money({currency:s.currency,amountMinor:s.predictedAmountMinor})}</Copy>
      <Copy dark={dark} heading>Classification</Copy><View style={styles.wrap}>{classes.map(c=><Action key={c} dark={dark} label={`Classify as ${c}`} radio selected={s.classification===c} disabled={disabled} onPress={()=>onClassify(c)}/>)}</View>
      <Copy dark={dark}>Expected commitments and posted history remain separate.</Copy><Copy dark={dark} heading>Payment history</Copy>
      {!detail.history.length?<Copy dark={dark}>No posted or pending members are available.</Copy>:null}
      {detail.history.map(h=><View key={h.providerTransactionId} style={styles.ruled}><Copy dark={dark}>{money(h)}</Copy><Copy dark={dark}>{h.date} · {h.status} · {h.kind}</Copy><Copy dark={dark}>Provider transaction: {h.providerTransactionId}{h.pendingProviderTransactionId?` · Pending: ${h.pendingProviderTransactionId}`:''}</Copy></View>)}
      {detail.nextCursor?<Action dark={dark} label="Load more history" onPress={onLoadMore} disabled={state.phase==='loading'}/>:null}</>:null}
    <MutationStatus dark={dark} mutation={mutation}/><Action dark={dark} label="Close recurring detail" onPress={onClose}/>
  </DetailModal>;
}

export function ReviewView({dark,state,mutation,selected,draft={category:'',note:''},onRetry,onLoadMore,onOpen,onClose,onResolve,onSave,onDraft}:Base&{state:LoadState<ReviewPage>;selected:Alert|null;draft?:{category:string;note:string};onOpen(alert:Alert):void;onClose():void;onResolve(alert:Alert,decision:string):void;onSave(alert:Alert):void;onDraft(value:{category:string;note:string}):void}) {
  const disabled=state.phase!=='ready'||mutation.blocked||mutation.status==='revision_conflict';
  const input={...styles.input,color:dark?'#EEF1E8':'#18201F',borderColor:dark?'#43534B':'#D2CCC0'};
  return <View style={styles.section}>
    <Copy dark={dark}>Owner decisions preserve raw evidence and confirmed state.</Copy><Status dark={dark} state={state} label="Review" onRetry={onRetry}/>
    {state.data&&!state.data.items.length?<Copy dark={dark}>No owner alert projections are present.</Copy>:null}
    {state.data?.items.map(alert=><Card key={alert.eventId} dark={dark}><Action dark={dark} label={`Review ${alert.eventType}, ${alert.state}, r${alert.revision}`} onPress={()=>onOpen(alert)}/><Copy dark={dark}>{alert.reportingDate??'Date unavailable'} · {money(alert.affectedMoney??alert.countedMoney)}</Copy><Copy dark={dark}>{alert.reasonCodes.join(', ')}</Copy></Card>)}
    {state.data?.nextCursor?<Action dark={dark} label="Load more Review" onPress={onLoadMore} disabled={state.phase==='loading'}/>:null}
    <MutationStatus dark={dark} mutation={mutation}/>
    {selected&&state.phase!=='locked'?<DetailModal dark={dark} title="Review evidence" onClose={onClose}>
      <Copy dark={dark} heading>{selected.eventType}</Copy><Copy dark={dark}>{selected.state} · {selected.reportingDate??'Date unavailable'} · r{selected.revision}</Copy><Copy dark={dark}>Event: {selected.eventId}</Copy>
      <Copy dark={dark}>Counted: {money(selected.countedMoney)} · Affected: {money(selected.affectedMoney)}</Copy><Copy dark={dark}>Reason codes: {selected.reasonCodes.join(', ')||'none supplied'}</Copy>
      {selected.sourceEvidence?<><Copy dark={dark} heading>Source evidence</Copy><Copy dark={dark}>{selected.sourceEvidence.sourceProfileId} · Parser {selected.sourceEvidence.parserVersion} · {selected.sourceEvidence.eventTimeBasis}</Copy><Copy dark={dark}>Captured {selected.sourceEvidence.capturedAt} · Posted {selected.sourceEvidence.notificationPostedAt??'unavailable'}</Copy><Copy dark={dark}>Source merchant: {selected.sourceEvidence.merchant??'unavailable'}</Copy><Copy dark={dark}>Bank reference: {selected.sourceEvidence.bankReference??'unavailable'}</Copy><Copy dark={dark}>Source amount: {money(selected.sourceEvidence.eventMoney)}</Copy></>:null}
      <Copy dark={dark} heading>Provenance</Copy>{selected.provenance.map((p,i)=><Copy key={i} dark={dark}>{p.sourceKind}/{p.sourceId} · {p.basis} · r{p.revision}</Copy>)}
      <Copy dark={dark} heading>Candidate transaction comparison</Copy>{!selected.candidates.length?<Copy dark={dark}>No bounded candidates were returned.</Copy>:null}
      {selected.candidates.map(c=><View key={c.id} style={styles.ruled}><Copy dark={dark}>{c.targetTransaction.merchant} · {c.targetTransaction.date} · {money(c.targetTransaction)}</Copy><Copy dark={dark}>{c.targetTransaction.kind} · {c.targetTransaction.status} · {c.targetTransaction.source}</Copy><Copy dark={dark}>Target {c.targetTransaction.id} · Candidate {c.candidateTransactionId} · {c.score}%</Copy><Copy dark={dark}>{c.status} · {c.evidenceBasis} · {c.relation??'unsupported'} · {c.reasonCodes.join(', ')}</Copy></View>)}
      {selected.links.length?<Copy dark={dark} heading>Existing links</Copy>:null}{selected.links.map(l=><Copy dark={dark} key={l.id}>{l.relation} → {l.targetTransactionId??l.targetEventId} · {money(l.allocatedMoney)} · {l.evidenceBasis} · r{l.revision}</Copy>)}
      {(['keep_separate','ignore','link','classify'] as const).map(decision=>{const reason=reviewDisabledReason(selected,decision),label=({keep_separate:'Keep separate',ignore:'Ignore',link:'Link candidate',classify:'Classify event'})[decision];return <View key={decision}><Action dark={dark} label={label} disabled={disabled||!!reason} onPress={()=>onResolve(selected,decision)}/>{reason?<Copy dark={dark}>{reason}</Copy>:null}</View>;})}
      {selected.annotation&&!selected.annotationDisabledReason?<><Copy dark={dark} heading>Category and note</Copy><Copy dark={dark}>Transaction {selected.annotation.transactionId} · Revision {selected.annotation.expectedRevision}</Copy><TextInput accessibilityLabel="Review category" value={draft.category} maxLength={80} editable={!mutation.blocked} style={input} onChangeText={category=>onDraft({...draft,category})}/><TextInput accessibilityLabel="Review note" value={draft.note} maxLength={1000} multiline editable={!mutation.blocked} style={input} onChangeText={note=>onDraft({...draft,note})}/><Action dark={dark} label="Save category and note" disabled={disabled||!draft.category.trim()} onPress={()=>onSave(selected)}/></>:<Copy dark={dark}>{selected.annotationDisabledReason??'Category/note annotation is unavailable for this alert.'}</Copy>}
      <MutationStatus dark={dark} mutation={mutation}/><Action dark={dark} label="Close Review evidence" onPress={onClose}/>
    </DetailModal>:null}
  </View>;
}

export function AccountsView({dark,state,mutation,onRetry,onLoadMore,onConnect,onSelect,onCancel,onSync,onDisconnect}:Base&{state:LoadState<AccountsData>;onConnect(reconnect:string|null):void;onSelect(ids:string[]):void;onCancel():void;onSync():void;onDisconnect(id:string):void}) {
  const data=state.data,link=data?.link,[selected,setSelected]=useState<string[]>([]),[account,setAccount]=useState<Account|null>(null),[disconnect,setDisconnect]=useState<Connection|null>(null);
  useEffect(()=>{setSelected([]);},[link?.pendingConnectionId]);
  useEffect(()=>{if(state.phase==='locked'){setAccount(null);setDisconnect(null);setSelected([]);}},[state.phase]);
  const disabled=state.phase!=='ready'||mutation.blocked||mutation.status==='revision_conflict'||link?.state==='reconciliation_required';
  const outcome=link?.outcomeCode??link?.state;
  const message=outcome==='canceled'?'Connection canceled. No account was added.':outcome==='failed'?'Bank authorization failed. Refresh the native operation status before trying again.':outcome==='reconciliation_required'?'The bank connection is being reconciled. Keep this app open or return later; do not start another connection yet.':outcome==='unsupported'?'Bank authorization is unavailable on this device.':link?.state==='pending'?'Choose accounts. This review expires in 15 minutes; the server verifies the selected IDs.':link?.state==='connected'?'Bank connected. Only selected accounts are active; refresh is requested separately.':link?.state==='loading'?'Preparing secure bank authorization…':link?.state==='linking'?'Complete authorization with your bank…':'';
  return <View style={styles.section}>
    <Copy dark={dark}>Plaid handles bank authorization. Select which accounts Border Ledger can use.</Copy><Status dark={dark} state={state} onRetry={onRetry} label="bank status"/>
    {message?<View accessibilityLiveRegion="polite"><Copy dark={dark}>{message}</Copy></View>:null}
    {data?<><Copy dark={dark} heading>Bank connections</Copy>{!data.connections.length?<Copy dark={dark}>No active bank connections are available.</Copy>:null}
      {data.connections.map(c=><Card key={c.connectionId} dark={dark}><Copy dark={dark} heading>{c.institution??'Bank connection'}</Copy><Copy dark={dark}>{c.state} · Last sync {c.lastSyncedAt??'not synced yet'}</Copy><Copy dark={dark}>Expires {c.expiresAt??'unavailable'} · Cleanup: {c.cleanupState??'none'}</Copy>{c.lastError?<Copy dark={dark} error>Provider status: {c.lastError}</Copy>:null}<Action dark={dark} label={`Reconnect ${c.institution??'bank'}`} disabled={disabled||link?.state==='pending'||link?.state==='loading'||link?.state==='linking'} onPress={()=>onConnect(c.connectionId)}/><Action dark={dark} label={`Disconnect ${c.institution??'bank'}`} disabled={disabled} onPress={()=>setDisconnect(c)}/></Card>)}
      <Action dark={dark} label="Request bank sync" disabled={disabled} onPress={onSync}/><Copy dark={dark}>A confirmed request may remain queued. Last sync changes only when the native service reports it.</Copy>
      <Copy dark={dark} heading>Accounts</Copy>{!data.page.accounts.length?<Copy dark={dark}>No selected accounts are available.</Copy>:null}{data.page.accounts.map(a=><View key={a.providerAccountId}><Action dark={dark} label={`Open account ${a.name}`} onPress={()=>setAccount(a)}/><Copy dark={dark}>{a.currency} · {a.kind} · {a.mask?`••${a.mask}`:'mask unavailable'}</Copy></View>)}
      {data.page.nextCursor?<Action dark={dark} label="Load more accounts" disabled={state.phase==='loading'} onPress={onLoadMore}/>:null}
      {link?.state==='pending'?<><Copy dark={dark} heading>Choose accounts</Copy>{link.accounts.map(a=>{const checked=selected.includes(a.providerAccountId);return <Pressable key={a.providerAccountId} accessibilityRole="checkbox" accessibilityLabel={`Select account ${a.name}, ${a.currency}, ending ${a.mask??'unavailable'}`} accessibilityState={{checked,disabled}} disabled={disabled} onPress={()=>setSelected(ids=>checked?ids.filter(id=>id!==a.providerAccountId):[...ids,a.providerAccountId])} style={styles.choice}><Copy dark={dark}>{a.name} · {a.kind} · {a.currency} · {a.mask?`••${a.mask}`:'mask unavailable'} · {checked?'Selected':'Select'}</Copy></Pressable>;})}<Action dark={dark} label="Confirm selected accounts" disabled={disabled||!selected.length} onPress={()=>onSelect(selected)}/><Action dark={dark} label="Cancel pending connection" disabled={disabled} onPress={onCancel}/></>:<Action dark={dark} label="Start bank connection" disabled={disabled||link?.state==='loading'||link?.state==='linking'} onPress={()=>onConnect(null)}/>}</>:null}
    <MutationStatus dark={dark} mutation={mutation}/>
    {account&&state.phase!=='locked'?<DetailModal dark={dark} title="Account detail" onClose={()=>setAccount(null)}><Copy dark={dark} heading>{account.name}</Copy><Copy dark={dark}>Currency: {account.currency}</Copy><Copy dark={dark}>Kind: {account.kind} · Subtype: {account.subtype??'unavailable'}</Copy><Copy dark={dark}>Mask: {account.mask?`••${account.mask}`:'unavailable'}</Copy><Copy dark={dark}>Provider account: {account.providerAccountId}</Copy><Action dark={dark} label="Close account detail" onPress={()=>setAccount(null)}/></DetailModal>:null}
    {disconnect&&state.phase!=='locked'?<DetailModal dark={dark} title="Confirm disconnect" onClose={()=>setDisconnect(null)}><Copy dark={dark}>Disconnect {disconnect.institution??'this bank'}? The provider connection will be removed. Cleanup may remain pending.</Copy><Action dark={dark} label="Confirm disconnect" disabled={disabled} onPress={()=>{onDisconnect(disconnect.connectionId);setDisconnect(null);}}/><Action dark={dark} label="Keep connection" onPress={()=>setDisconnect(null)}/></DetailModal>:null}
  </View>;
}
const styles=StyleSheet.create({section:{marginTop:16,gap:12},wrap:{flexDirection:'row',flexWrap:'wrap',gap:8},ruled:{borderTopWidth:1,borderColor:'#68706D',paddingTop:12,gap:4},input:{minHeight:48,borderWidth:1,borderRadius:12,padding:12,fontFamily:'DMSans',fontSize:16},choice:{minHeight:48,padding:12,borderWidth:1,borderColor:'#68706D',borderRadius:12}});
