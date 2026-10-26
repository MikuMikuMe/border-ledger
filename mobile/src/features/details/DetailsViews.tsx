import {type LunchFlowActions} from './LunchFlowControls';
import {LunchFlowSection} from './LunchFlowAccounts';
import type {LunchFlowBinding} from './contracts';
import React,{useEffect,useState} from 'react';
import {Pressable,StyleSheet,TextInput,View} from 'react-native';
import {Action,Card,Copy,DetailModal,MutationStatus,Status} from '../finance/FinanceViews';
import {formatMoney,type LoadState} from '../finance/model';
import type {MutationState} from '../finance/contracts';
import type {Account,AccountsData,Alert,Connection,Detail,LinkSnapshot,LunchFlowSelection,ReviewPage} from './contracts';
import {reviewDisabledReason} from './DetailsController';
import type {Classification,ReviewDecision} from './DetailsController';
type Theme={dark:boolean};
type Base=Theme&{mutation:MutationState;onRetry():void;onLoadMore():void};
type Draft={category:string;note:string};
const classes:readonly Classification[]=['unclassified','subscription','bill','other','excluded'];
const decisions:readonly ReviewDecision[]=['keep_separate','ignore','link','classify'];
const decisionLabels={keep_separate:'Keep separate',ignore:'Ignore',link:'Link candidate',classify:'Classify event'} as const;
const money=(value:{currency:string;amountMinor:string}|null)=>value?`${value.currency} · ${formatMoney(value.amountMinor,value.currency)}`:'unavailable';
const isMutationDisabled=(state:LoadState<unknown>,mutation:MutationState)=>state.phase!=='ready'||mutation.blocked||mutation.status==='revision_conflict';

function RecurringSummary({dark,stream}:{dark:boolean;stream:Detail['stream']}){
  return <>
    <Copy dark={dark} heading>{stream.merchantName??'Merchant unavailable'}</Copy><Copy dark={dark}>{stream.currency} · {stream.frequency} · Source {stream.sourceStatus} · Revision {stream.revision}</Copy>
    <Copy dark={dark}>Account: {stream.accountId} · {stream.isOutflow?'Outflow':'Inflow'}</Copy><Copy dark={dark}>Source frequency: {stream.sourceFrequency??'unavailable'} · Source updated {stream.sourceUpdatedAt??'unavailable'}</Copy>
    <Copy dark={dark}>First {stream.firstDate??'unavailable'} · Latest {stream.lastDate??'unavailable'}</Copy><Copy dark={dark}>Average: {stream.averageAmountMinor===null?'unavailable':money({currency:stream.currency,amountMinor:stream.averageAmountMinor})}</Copy>
    <Copy dark={dark}>Last: {stream.lastAmountMinor===null?'unavailable':money({currency:stream.currency,amountMinor:stream.lastAmountMinor})}</Copy><Copy dark={dark}>Next expected: {stream.predictedNextDate??'unavailable'} · {stream.predictedAmountMinor===null?'unavailable':money({currency:stream.currency,amountMinor:stream.predictedAmountMinor})}</Copy>
  </>;
}

function ClassificationActions({dark,stream,disabled,onClassify}:{dark:boolean;stream:Detail['stream'];disabled:boolean;onClassify(value:Classification):void}){
  return <><Copy dark={dark} heading>Classification</Copy><View style={styles.wrap}>{classes.map(value=><Action key={value} dark={dark} label={`Classify as ${value}`} radio selected={stream.classification===value} disabled={disabled} onPress={()=>onClassify(value)}/>)}</View></>;
}

function PaymentHistory({dark,detail,loading,onLoadMore}:{dark:boolean;detail:Detail;loading:boolean;onLoadMore():void}){
  return <><Copy dark={dark}>Expected commitments and posted history remain separate.</Copy><Copy dark={dark} heading>Payment history</Copy>{!detail.history.length?<Copy dark={dark}>No posted or pending members are available.</Copy>:null}{detail.history.map(history=><View key={history.providerTransactionId} style={styles.ruled}><Copy dark={dark}>{money(history)}</Copy><Copy dark={dark}>{history.date} · {history.status} · {history.kind}</Copy><Copy dark={dark}>Provider transaction: {history.providerTransactionId}{history.pendingProviderTransactionId?` · Pending: ${history.pendingProviderTransactionId}`:''}</Copy></View>)}{detail.nextCursor?<Action dark={dark} label="Load more history" disabled={loading} onPress={onLoadMore}/>:null}</>;
}

export function RecurringDetailView({dark,state,mutation,onRetry,onLoadMore,onClose,onClassify}:Base&{state:LoadState<Detail>;onClose():void;onClassify(value:Classification):void}) {
  const detail=state.data,disabled=isMutationDisabled(state,mutation);
  return <DetailModal dark={dark} title="Recurring detail" onClose={onClose}>
    <Status dark={dark} state={state} label="recurring detail" onRetry={onRetry}/>
    {detail?.stream?<><RecurringSummary dark={dark} stream={detail.stream}/><ClassificationActions dark={dark} stream={detail.stream} disabled={disabled} onClassify={onClassify}/><PaymentHistory dark={dark} detail={detail} loading={state.phase==='loading'} onLoadMore={onLoadMore}/></>:null}
    <MutationStatus dark={dark} mutation={mutation}/><Action dark={dark} label="Close recurring detail" onPress={onClose}/>
  </DetailModal>;
}

function ReviewList({dark,state,onOpen,onLoadMore}:{dark:boolean;state:LoadState<ReviewPage>;onOpen(alert:Alert):void;onLoadMore():void}){
  return <>
    {state.data&&!state.data.items.length?<Copy dark={dark}>No owner alert projections are present.</Copy>:null}
    {state.data?.items.map(alert=><Card key={alert.eventId} dark={dark}><Action dark={dark} label={`Review ${alert.eventType}, ${alert.state}, r${alert.revision}`} onPress={()=>onOpen(alert)}/><Copy dark={dark}>{alert.reportingDate??'Date unavailable'} · {money(alert.affectedMoney??alert.countedMoney)}</Copy><Copy dark={dark}>{alert.reasonCodes.join(', ')}</Copy></Card>)}
    {state.data?.nextCursor?<Action dark={dark} label="Load more Review" onPress={onLoadMore} disabled={state.phase==='loading'}/>:null}
  </>;
}

function SourceEvidence({dark,evidence}:{dark:boolean;evidence:Alert['sourceEvidence']}){
  if(!evidence)return null;
  return <><Copy dark={dark} heading>Source evidence</Copy><Copy dark={dark}>{evidence.sourceProfileId} · Parser {evidence.parserVersion} · {evidence.eventTimeBasis}</Copy><Copy dark={dark}>Captured {evidence.capturedAt} · Posted {evidence.notificationPostedAt??'unavailable'}</Copy><Copy dark={dark}>Source merchant: {evidence.merchant??'unavailable'}</Copy><Copy dark={dark}>Bank reference: {evidence.bankReference??'unavailable'}</Copy><Copy dark={dark}>Source amount: {money(evidence.eventMoney)}</Copy></>;
}

function CandidateEvidence({dark,selected}:{dark:boolean;selected:Alert}){
  return <><Copy dark={dark} heading>Candidate transaction comparison</Copy>{!selected.candidates.length?<Copy dark={dark}>No bounded candidates were returned.</Copy>:null}{selected.candidates.map(candidate=><View key={candidate.id} style={styles.ruled}><Copy dark={dark}>{candidate.targetTransaction.merchant} · {candidate.targetTransaction.date} · {money(candidate.targetTransaction)}</Copy><Copy dark={dark}>{candidate.targetTransaction.kind} · {candidate.targetTransaction.status} · {candidate.targetTransaction.source}</Copy><Copy dark={dark}>Target {candidate.targetTransaction.id} · Candidate {candidate.candidateTransactionId} · {candidate.score}%</Copy><Copy dark={dark}>{candidate.status} · {candidate.evidenceBasis} · {candidate.relation??'unsupported'} · {candidate.reasonCodes.join(', ')}</Copy></View>)}</>;
}

function DecisionActions({dark,selected,disabled,onResolve}:{dark:boolean;selected:Alert;disabled:boolean;onResolve(alert:Alert,decision:ReviewDecision):void}){
  return <>{decisions.map(decision=>{const reason=reviewDisabledReason(selected,decision);return <View key={decision}><Action dark={dark} label={decisionLabels[decision]} disabled={disabled||!!reason} onPress={()=>onResolve(selected,decision)}/>{reason?<Copy dark={dark}>{reason}</Copy>:null}</View>;})}</>;
}

function AnnotationEditor({dark,selected,draft,input,mutation,disabled,onSave,onDraft}:{dark:boolean;selected:Alert;draft:Draft;input:object;mutation:MutationState;disabled:boolean;onSave(alert:Alert):void;onDraft(value:Draft):void}){
  if(!selected.annotation||selected.annotationDisabledReason)return <Copy dark={dark}>{selected.annotationDisabledReason??'Category/note annotation is unavailable for this alert.'}</Copy>;
  return <><Copy dark={dark} heading>Category and note</Copy><Copy dark={dark}>Transaction {selected.annotation.transactionId} · Revision {selected.annotation.expectedRevision}</Copy><TextInput accessibilityLabel="Review category" value={draft.category} maxLength={80} editable={!mutation.blocked} style={input} onChangeText={category=>onDraft({...draft,category})}/><TextInput accessibilityLabel="Review note" value={draft.note} maxLength={1000} multiline editable={!mutation.blocked} style={input} onChangeText={note=>onDraft({...draft,note})}/><Action dark={dark} label="Save category and note" disabled={disabled||!draft.category.trim()} onPress={()=>onSave(selected)}/></>;
}

function ReviewEvidence({dark,selected,draft,mutation,disabled,onClose,onResolve,onSave,onDraft}:{dark:boolean;selected:Alert;draft:Draft;mutation:MutationState;disabled:boolean;onClose():void;onResolve(alert:Alert,decision:ReviewDecision):void;onSave(alert:Alert):void;onDraft(value:Draft):void}){
  const input={...styles.input,color:dark?'#EEF1E8':'#18201F',borderColor:dark?'#43534B':'#D2CCC0'};
  return <DetailModal dark={dark} title="Review evidence" onClose={onClose}><Copy dark={dark} heading>{selected.eventType}</Copy><Copy dark={dark}>{selected.state} · {selected.reportingDate??'Date unavailable'} · r{selected.revision}</Copy><Copy dark={dark}>Event: {selected.eventId}</Copy><Copy dark={dark}>Counted: {money(selected.countedMoney)} · Affected: {money(selected.affectedMoney)}</Copy><Copy dark={dark}>Reason codes: {selected.reasonCodes.join(', ')||'none supplied'}</Copy><SourceEvidence dark={dark} evidence={selected.sourceEvidence}/><Copy dark={dark} heading>Provenance</Copy>{selected.provenance.map((item,index)=><Copy key={`${item.sourceId}-${index}`} dark={dark}>{item.sourceKind}/{item.sourceId} · {item.basis} · r{item.revision}</Copy>)}<CandidateEvidence dark={dark} selected={selected}/>{selected.links.length?<><Copy dark={dark} heading>Existing links</Copy>{selected.links.map(link=><Copy dark={dark} key={link.id}>{link.relation} → {link.targetTransactionId??link.targetEventId} · {money(link.allocatedMoney)} · {link.evidenceBasis} · r{link.revision}</Copy>)}</>:null}<DecisionActions dark={dark} selected={selected} disabled={disabled} onResolve={onResolve}/><AnnotationEditor dark={dark} selected={selected} draft={draft} input={input} mutation={mutation} disabled={disabled} onSave={onSave} onDraft={onDraft}/><MutationStatus dark={dark} mutation={mutation}/><Action dark={dark} label="Close Review evidence" onPress={onClose}/></DetailModal>;
}

export function ReviewView({dark,state,mutation,selected,draft={category:'',note:''},onRetry,onLoadMore,onOpen,onClose,onResolve,onSave,onDraft}:Base&{state:LoadState<ReviewPage>;selected:Alert|null;draft?:Draft;onOpen(alert:Alert):void;onClose():void;onResolve(alert:Alert,decision:ReviewDecision):void;onSave(alert:Alert):void;onDraft(value:Draft):void}) {
  const disabled=isMutationDisabled(state,mutation);
  return <View style={styles.section}>
    <Copy dark={dark}>Owner decisions preserve raw evidence and confirmed state.</Copy><Status dark={dark} state={state} label="Review" onRetry={onRetry}/>
    <ReviewList dark={dark} state={state} onOpen={onOpen} onLoadMore={onLoadMore}/>
    <MutationStatus dark={dark} mutation={mutation}/>
    {selected&&state.phase!=='locked'?<ReviewEvidence dark={dark} selected={selected} draft={draft} mutation={mutation} disabled={disabled} onClose={onClose} onResolve={onResolve} onSave={onSave} onDraft={onDraft}/>:null}
  </View>;
}

const outcomeMessages:Record<string,string>={
  canceled:'Connection canceled. No account was added.',
  failed:'Bank authorization failed. Refresh the native operation status before trying again.',
  reconciliation_required:'The bank connection is being reconciled. Keep this app open or return later; do not start another connection yet.',
  unsupported:'Bank authorization is unavailable on this device.',
};
const stateMessages:Record<string,string>={
  pending:'Choose accounts. This review expires in 15 minutes; the server verifies the selected IDs.',
  connected:'Bank connected. Only selected accounts are active; refresh is requested separately.',
  loading:'Preparing secure bank authorization…',
  linking:'Complete authorization with your bank…',
};
function linkMessage(link:LinkSnapshot|undefined){
  if(!link)return '';
  return outcomeMessages[link.outcomeCode??'']??stateMessages[link.state]??'';
}

function ConnectionCards({dark,data,disabled,onConnect,onDisconnect}:{dark:boolean;data:AccountsData;disabled:boolean;onConnect(reconnect:string|null):void;onDisconnect(connection:Connection):void}){
  if(!data.connections.length)return <Copy dark={dark}>No active bank connections are available.</Copy>;
  return <>{data.connections.map(connection=><Card key={connection.connectionId} dark={dark}><Copy dark={dark} heading>{connection.institution??'Bank connection'}</Copy><Copy dark={dark}>{connection.state} · Last sync {connection.lastSyncedAt??'not synced yet'}</Copy><Copy dark={dark}>Expires {connection.expiresAt??'unavailable'} · Cleanup: {connection.cleanupState??'none'}</Copy>{connection.lastError?<Copy dark={dark} error>Provider status: {connection.lastError}</Copy>:null}<Action dark={dark} label={`Reconnect ${connection.institution??'bank'}`} disabled={disabled} onPress={()=>onConnect(connection.connectionId)}/><Action dark={dark} label={`Disconnect ${connection.institution??'bank'}`} disabled={disabled} onPress={()=>onDisconnect(connection)}/></Card>)}</>;
}

function AccountCards({dark,data,onSelect}:{dark:boolean;data:AccountsData;onSelect(account:Account):void}){
  return <>{!data.page.accounts.length?<Copy dark={dark}>No selected accounts are available.</Copy>:null}{data.page.accounts.map(account=><View key={account.providerAccountId}><Action dark={dark} label={`Open account ${account.name}`} onPress={()=>onSelect(account)}/><Copy dark={dark}>{account.currency} · {account.kind} · {account.mask?`••${account.mask}`:'mask unavailable'}</Copy></View>)}</>;
}

function PendingAccountChooser({dark,link,disabled,selected,setSelected,onSelect,onCancel}:{dark:boolean;link:LinkSnapshot;disabled:boolean;selected:string[];setSelected:React.Dispatch<React.SetStateAction<string[]>>;onSelect(ids:string[]):void;onCancel():void}){
  return <><Copy dark={dark} heading>Choose accounts</Copy>{link.accounts.map(account=>{const checked=selected.includes(account.providerAccountId);return <Pressable key={account.providerAccountId} accessibilityRole="checkbox" accessibilityLabel={`Select account ${account.name}, ${account.currency}, ending ${account.mask??'unavailable'}`} accessibilityState={{checked,disabled}} disabled={disabled} onPress={()=>setSelected(ids=>checked?ids.filter(id=>id!==account.providerAccountId):[...ids,account.providerAccountId])} style={styles.choice}><Copy dark={dark}>{account.name} · {account.kind} · {account.currency} · {account.mask?`••${account.mask}`:'mask unavailable'} · {checked?'Selected':'Select'}</Copy></Pressable>;})}<Action dark={dark} label="Confirm selected accounts" disabled={disabled||!selected.length} onPress={()=>onSelect(selected)}/><Action dark={dark} label="Cancel pending connection" disabled={disabled} onPress={onCancel}/></>;
}

function AccountModals({dark,state,account,disconnect,disabled,onCloseAccount,onConfirmDisconnect,onCloseDisconnect}:{dark:boolean;state:LoadState<AccountsData>;account:Account|null;disconnect:Connection|null;disabled:boolean;onCloseAccount():void;onConfirmDisconnect():void;onCloseDisconnect():void}){
  return <>{account&&state.phase!=='locked'?<DetailModal dark={dark} title="Account detail" onClose={onCloseAccount}><Copy dark={dark} heading>{account.name}</Copy><Copy dark={dark}>Currency: {account.currency}</Copy><Copy dark={dark}>Kind: {account.kind} · Subtype: {account.subtype??'unavailable'}</Copy><Copy dark={dark}>Mask: {account.mask?`••${account.mask}`:'unavailable'}</Copy><Copy dark={dark}>Provider account: {account.providerAccountId}</Copy><Action dark={dark} label="Close account detail" onPress={onCloseAccount}/></DetailModal>:null}{disconnect&&state.phase!=='locked'?<DetailModal dark={dark} title="Confirm disconnect" onClose={onCloseDisconnect}><Copy dark={dark}>Disconnect {disconnect.institution??'this bank'}? The provider connection will be removed. Cleanup may remain pending.</Copy><Action dark={dark} label="Confirm disconnect" disabled={disabled} onPress={onConfirmDisconnect}/><Action dark={dark} label="Keep connection" onPress={onCloseDisconnect}/></DetailModal>:null}</>;
}

function AccountPagination({dark,data,state,onLoadMore}:{dark:boolean;data:AccountsData;state:LoadState<AccountsData>;onLoadMore():void}){
  return data.page.nextCursor?<Action dark={dark} label="Load more accounts" disabled={state.phase==='loading'} onPress={onLoadMore}/>:null;
}

function ConnectionFlow({dark,link,disabled,selected,setSelected,onSelect,onCancel,onConnect}:{dark:boolean;link:LinkSnapshot|undefined;disabled:boolean;selected:string[];setSelected:React.Dispatch<React.SetStateAction<string[]>>;onSelect(ids:string[]):void;onCancel():void;onConnect(reconnect:string|null):void}){
  if(link?.state==='pending'&&link)return <PendingAccountChooser dark={dark} link={link} disabled={disabled} selected={selected} setSelected={setSelected} onSelect={onSelect} onCancel={onCancel}/>;
  return <Action dark={dark} label="Start bank connection" disabled={disabled||link?.state==='loading'||link?.state==='linking'} onPress={()=>onConnect(null)}/>;
}

function AccountsDataSection({lunchFlowActions,dark,state,data,link,disabled,lunchFlowDisabled,selected,setSelected,onLoadMore,onConnect,onSelect,onCancel,onSync,onDisconnect,onOpenAccount,onLunchFlowSelection,onLunchFlowSync}:{lunchFlowActions:LunchFlowActions;dark:boolean;state:LoadState<AccountsData>;data:AccountsData;link:LinkSnapshot|undefined;disabled:boolean;lunchFlowDisabled:boolean;selected:string[];setSelected:React.Dispatch<React.SetStateAction<string[]>>;onLoadMore():void;onConnect(reconnect:string|null):void;onSelect(ids:string[]):void;onCancel():void;onSync():void;onDisconnect(connection:Connection):void;onOpenAccount(account:Account):void;onLunchFlowSelection(selections:LunchFlowSelection[]):void;onLunchFlowSync():void}){
  const connectionDisabled=disabled||link?.state==='pending'||link?.state==='loading'||link?.state==='linking';
  return <><Copy dark={dark} heading>Bank connections</Copy><ConnectionCards dark={dark} data={data} disabled={connectionDisabled} onConnect={onConnect} onDisconnect={onDisconnect}/><Action dark={dark} label="Request bank sync" disabled={disabled} onPress={onSync}/><Copy dark={dark}>A confirmed request may remain queued. Last sync changes only when the native service reports it.</Copy><Copy dark={dark} heading>Accounts</Copy><AccountCards dark={dark} data={data} onSelect={onOpenAccount}/><AccountPagination dark={dark} data={data} state={state} onLoadMore={onLoadMore}/><ConnectionFlow dark={dark} link={link} disabled={disabled} selected={selected} setSelected={setSelected} onSelect={onSelect} onCancel={onCancel} onConnect={onConnect}/><LunchFlowSection dark={dark} value={data.lunchFlow} connection={data.lunchFlowConnection} actions={lunchFlowActions} disabled={lunchFlowDisabled} onSave={onLunchFlowSelection} onSync={onLunchFlowSync}/></>;
}

function AccountsBody({lunchFlowActions,dark,state,data,link,disabled,lunchFlowDisabled,selected,setSelected,message,onRetry,onCancelConnect,onLoadMore,onConnect,onSelect,onCancel,onSync,onDisconnect,onOpenAccount,onLunchFlowSelection,onLunchFlowSync}:{lunchFlowActions:LunchFlowActions;dark:boolean;state:LoadState<AccountsData>;data:AccountsData|null;link:LinkSnapshot|undefined;disabled:boolean;lunchFlowDisabled:boolean;selected:string[];setSelected:React.Dispatch<React.SetStateAction<string[]>>;message:string;onRetry():void;onCancelConnect():void;onLoadMore():void;onConnect(reconnect:string|null):void;onSelect(ids:string[]):void;onCancel():void;onSync():void;onDisconnect(connection:Connection):void;onOpenAccount(account:Account):void;onLunchFlowSelection(selections:LunchFlowSelection[]):void;onLunchFlowSync():void}){
  const canCancel=link?.state==='linking'&&!!link.canCancel;
  return <><Copy dark={dark}>Plaid handles bank authorization. Select which accounts Border Ledger can use.</Copy><Status dark={dark} state={state} onRetry={onRetry} label="bank status"/>{message?<View accessibilityLiveRegion="polite"><Copy dark={dark}>{message}</Copy></View>:null}{canCancel?<View><Copy dark={dark}>Authorization has not opened yet. You can safely cancel this handoff.</Copy><Action dark={dark} label="Cancel bank authorization" disabled={state.phase!=='ready'} onPress={onCancelConnect}/></View>:null}{data?<AccountsDataSection lunchFlowActions={lunchFlowActions} dark={dark} state={state} data={data} link={link} disabled={disabled} lunchFlowDisabled={lunchFlowDisabled} selected={selected} setSelected={setSelected} onLoadMore={onLoadMore} onConnect={onConnect} onSelect={onSelect} onCancel={onCancel} onSync={onSync} onDisconnect={onDisconnect} onOpenAccount={onOpenAccount} onLunchFlowSelection={onLunchFlowSelection} onLunchFlowSync={onLunchFlowSync}/>:null}</>;
}

function useAccountInteractions(state:LoadState<AccountsData>,onDisconnect:(id:string)=>void){
  const [selected,setSelected]=useState<string[]>([]),[account,setAccount]=useState<Account|null>(null),[disconnect,setDisconnect]=useState<Connection|null>(null);
  const pendingConnectionId=state.data?.link?.pendingConnectionId;
  useEffect(()=>{setSelected([]);},[pendingConnectionId]);
  useEffect(()=>{if(state.phase==='locked'){setAccount(null);setDisconnect(null);setSelected([]);}},[state.phase]);
  const confirmDisconnect=()=>{if(disconnect){onDisconnect(disconnect.connectionId);setDisconnect(null);}};
  return {selected,setSelected,account,setAccount,disconnect,setDisconnect,confirmDisconnect};
}

export function AccountsView({lunchFlowMessage=null,onLunchFlowAuthorize=()=>{},onLunchFlowCancel=()=>{},onLunchFlowDisconnect=()=>{},dark,state,mutation,lunchFlowBusy=false,onRetry,onLoadMore,onConnect,onCancelConnect,onSelect,onCancel,onSync,onDisconnect,onLunchFlowSelection=()=>{},onLunchFlowSync=()=>{}}:Base&{lunchFlowMessage?:string|null;onLunchFlowAuthorize?():void;onLunchFlowCancel?():void;onLunchFlowDisconnect?(binding:LunchFlowBinding):void;state:LoadState<AccountsData>;lunchFlowBusy?:boolean;onConnect(reconnect:string|null):void;onCancelConnect():void;onSelect(ids:string[]):void;onCancel():void;onSync():void;onDisconnect(id:string):void;onLunchFlowSelection?(selections:LunchFlowSelection[]):void;onLunchFlowSync?():void}) {
  const data=state.data,link=data?.link;
  const {selected,setSelected,account,setAccount,disconnect,setDisconnect,confirmDisconnect}=useAccountInteractions(state,onDisconnect);
  const disabled=isMutationDisabled(state,mutation)||link?.state==='reconciliation_required',lunchFlowDisabled=disabled||lunchFlowBusy;
  const message=linkMessage(link);
  return <View style={styles.section}>
    <AccountsBody lunchFlowActions={{message:lunchFlowMessage,authorize:onLunchFlowAuthorize,cancel:onLunchFlowCancel,disconnect:onLunchFlowDisconnect}} dark={dark} state={state} data={data} link={link} disabled={disabled} lunchFlowDisabled={lunchFlowDisabled} selected={selected} setSelected={setSelected} message={message} onRetry={onRetry} onCancelConnect={onCancelConnect} onLoadMore={onLoadMore} onConnect={onConnect} onSelect={onSelect} onCancel={onCancel} onSync={onSync} onDisconnect={connection=>setDisconnect(connection)} onOpenAccount={setAccount} onLunchFlowSelection={onLunchFlowSelection} onLunchFlowSync={onLunchFlowSync}/>
    <MutationStatus dark={dark} mutation={mutation}/>
    <AccountModals dark={dark} state={state} account={account} disconnect={disconnect} disabled={disabled} onCloseAccount={()=>setAccount(null)} onConfirmDisconnect={confirmDisconnect} onCloseDisconnect={()=>setDisconnect(null)}/>
  </View>;
}
const styles=StyleSheet.create({section:{marginTop:16,gap:12},wrap:{flexDirection:'row',flexWrap:'wrap',gap:8},ruled:{borderTopWidth:1,borderColor:'#68706D',paddingTop:12,gap:4},input:{minHeight:48,borderWidth:1,borderRadius:12,padding:12,fontFamily:'DMSans',fontSize:16},choice:{minHeight:48,padding:12,borderWidth:1,borderColor:'#68706D',borderRadius:12}});
