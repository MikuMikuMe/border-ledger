import React,{useRef} from 'react';
import {AccessibilityInfo,ActivityIndicator,findNodeHandle,KeyboardAvoidingView,Modal,Pressable,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import type {ActivityQuery,Report,Snapshot,Transaction,Transactions,Stream,Lens,RecurringData,MutationState} from './contracts';
import {filterActivity,formatMoney,recurringMessage,reportingCurrencies,reportView,type LoadState,type Window} from './model';

const palette=(dark:boolean)=>dark?{text:'#EEF1E8',muted:'#A5B2AA',surface:'#1D2925',border:'#43534B',accent:'#83C9B1',error:'#FFB4AB'}:{text:'#18201F',muted:'#4F5C56',surface:'#FBF9F4',border:'#D2CCC0',accent:'#1B6B5B',error:'#A83F3F'};
type Theme={dark:boolean};
export function Copy({dark,children,heading=false,error=false}:Theme&{children:React.ReactNode;heading?:boolean;error?:boolean}) {
  const p=palette(dark);return <Text accessibilityRole={heading?'header':undefined} style={[styles.copy,{color:error?p.error:p.text},heading&&styles.heading]}>{children}</Text>;
}
export function Card({dark,children}:Theme&{children:React.ReactNode}) {const p=palette(dark);return <View style={[styles.card,{backgroundColor:p.surface,borderColor:p.border}]}>{children}</View>;}
export function DetailModal({dark,title,onClose,children}:Theme&{title:string;onClose():void;children:React.ReactNode}) {
  const heading=useRef<React.ElementRef<typeof Text>>(null);
  return <Modal transparent visible animationType="none" onRequestClose={onClose} onShow={()=>{const node=findNodeHandle(heading.current);if(node)AccessibilityInfo.setAccessibilityFocus(node);}}>
    <KeyboardAvoidingView behavior="padding" style={{flex:1,justifyContent:'center',padding:18,backgroundColor:'#00000080'}}>
      <View accessibilityViewIsModal style={[styles.card,{maxHeight:'90%',backgroundColor:palette(dark).surface,borderColor:palette(dark).border}]}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.section}><Text ref={heading} accessible accessibilityRole="header" style={[styles.heading,{color:palette(dark).text}]}>{title}</Text>{children}</ScrollView></View>
    </KeyboardAvoidingView>
  </Modal>;
}
export function Action({dark,label,text,onPress,disabled=false,selected,radio=false}:Theme&{label:string;text?:string;onPress():void;disabled?:boolean;selected?:boolean;radio?:boolean}) {
  const p=palette(dark);return <Pressable accessibilityRole={radio?'radio':'button'} accessibilityLabel={label} accessibilityState={{disabled,...(selected===undefined?{}:{selected,checked:selected})}} onPress={onPress} disabled={disabled} style={{...styles.action,borderColor:p.border,backgroundColor:selected?(dark?'#1D5145':'#D2E9DF'):p.surface,opacity:disabled?0.6:1}}><Text style={[styles.copy,{color:p.accent}]}>{text??label}</Text></Pressable>;
}
function Choices({dark,label,values,value,onChange}:Theme&{label:string;values:string[];value:string|null;onChange(value:string|null):void}) {
  return <View style={styles.section}><Copy dark={dark} heading>{label}</Copy><ScrollView horizontal contentContainerStyle={{gap:8}}>{[null,...new Set([...(value?[value]:[]),...values])].map(v=><Action key={v??'all'} dark={dark} label={`${label}: ${v??'All'}`} text={v??'All'} selected={v===value} radio onPress={()=>onChange(v)}/>)}</ScrollView></View>;
}
export function Status({dark,state,onRetry,label}:Theme&{state:LoadState<unknown>;onRetry():void;label:string}) {
  return <View style={styles.section} accessibilityLiveRegion="polite" accessibilityRole={state.message?'alert':undefined}>
    {state.phase==='loading'?<><ActivityIndicator accessibilityLabel={`Loading ${label}`} color={palette(dark).accent}/><Copy dark={dark}>Loading {label}…</Copy></>:null}
    {state.message?<Copy dark={dark} error>{state.message}</Copy>:null}
    <Action dark={dark} label={`Refresh ${label}`} onPress={onRetry} disabled={state.phase==='loading'}/>
  </View>;
}
function MoneyRows({dark,label,values}:Theme&{label:string;values:{currency:string;amountMinor:string}[]}) {
  return <Card dark={dark}><Copy dark={dark} heading>{label}</Copy>{values.length?values.map(v=><Copy key={v.currency} dark={dark}>{v.currency} · {formatMoney(v.amountMinor,v.currency)}</Copy>):<Copy dark={dark}>No supported amount is available.</Copy>}</Card>;
}
export function OverviewView({dark,state,snapshot,lens,currencies,onLens,onRetry}:Theme&{state:LoadState<Report>;snapshot:Snapshot|null;lens:Lens;currencies:string[];onLens(value:Lens):void;onRetry():void}) {
  const report=state.data,view=report?reportView(report,lens.include,lens.source):null;
  return <View style={styles.section}>
    <Copy dark={dark}>Server snapshot only; unsent capture records are not included.</Copy>
    {snapshot?<Copy dark={dark}>Snapshot {snapshot.snapshotAt} · {snapshot.timeZone} · {snapshot.accounts.length} account(s)</Copy>:null}
    <Copy dark={dark} heading>Reporting lens</Copy><View style={styles.wrap}>{(['Today','Week','Month'] as Window[]).map(window=><Action key={window} dark={dark} label={`Report window: ${window}`} selected={window===lens.window} radio onPress={()=>onLens({...lens,window})}/>)}<Action dark={dark} label="Include provisional" selected={lens.include} onPress={()=>onLens({...lens,include:!lens.include})}/></View>
    <Choices dark={dark} label="Source currency (no conversion)" values={currencies} value={lens.source} onChange={source=>onLens({...lens,source})}/>
    <Choices dark={dark} label="Reporting currency" values={reportingCurrencies} value={lens.target} onChange={target=>onLens({...lens,target})}/>
    <Status dark={dark} state={state} onRetry={onRetry} label="report"/>
    {report&&view?<>
      <Copy dark={dark}>{report.from??'Full history'} to {report.to??'today'} · {report.timeBasis} · {report.timeZone??snapshot?.timeZone}</Copy>
      <Copy dark={dark}>As of {report.asOf??'unavailable'} · {lens.include?'Confirmed + provisional':'Confirmed only'}</Copy>
      {report.reportingCurrency?<Copy dark={dark} error={!report.fx.complete}>{report.fx.complete?'Locked to purchase dates using Frankfurter daily rates.':`Partial conversion. Unavailable source currencies: ${report.fx.unavailableSourceCurrencies.join(', ')||'see source audit'}.`}</Copy>:null}
      <MoneyRows dark={dark} label={report.reportingCurrency?`Total spending in ${report.reportingCurrency}`:'Net spending by source currency'} values={view.totals.map(v=>({currency:v.currency,amountMinor:v.amount}))}/>
      <Copy dark={dark}>{report.reviewCount} record(s) need review · Excluded: {report.excludedCount}</Copy>
      <Copy dark={dark} heading>Spending over time</Copy>
      {view.unavailable?<Copy dark={dark} error>Chart unavailable: conversion rates are not available for the locked purchase dates.</Copy>:null}
      {!view.lanes.length&&!view.unavailable?<Copy dark={dark}>No daily totals are available for this reporting lens.</Copy>:null}
      {view.lanes.map(lane=>{
        const max=lane.points.reduce((m,p)=>{const n=BigInt(p.amount);const abs=n<0n?-n:n;return abs>m?abs:m;},1n);
        return <Card dark={dark} key={lane.currency}><Copy dark={dark} heading>{lane.currency} · {report.reportingCurrency?'Locked target':'Source currency'}</Copy>
          <View importantForAccessibility="no-hide-descendants" style={styles.chart}>{lane.points.map(point=>{const n=BigInt(point.amount),negative=n<0n,abs=negative?-n:n;const height=Number(abs*100n/max);return <View key={point.date} style={styles.barColumn}><View style={[styles.bar,{height:Math.max(2,height/2),backgroundColor:negative?palette(dark).error:palette(dark).accent,top:negative?50:50-height/2}]}/></View>;})}</View>
          {lane.points.map(point=><View key={point.date} accessible accessibilityLabel={`${point.date}, ${lane.currency}, ${formatMoney(point.amount,lane.currency)}, confirmed ${formatMoney(point.confirmed,lane.currency)}${lens.include?`, provisional ${formatMoney(point.provisional,lane.currency)}`:''}`}><Copy dark={dark}>{point.date} · {formatMoney(point.amount,lane.currency)}</Copy><Copy dark={dark}>Confirmed {formatMoney(point.confirmed,lane.currency)}{lens.include?` · Provisional ${formatMoney(point.provisional,lane.currency)}`:''}</Copy></View>)}
        </Card>;
      })}
      {report.reportingCurrency?<MoneyRows dark={dark} label="Source currency audit" values={view.sourceTotals.map(v=>({currency:v.currency,amountMinor:v.amount}))}/>:null}
      {report.fx.chineseBankBand?<Card dark={dark}><Copy dark={dark} heading>Chinese bank estimate band</Copy><Copy dark={dark}>{report.fx.chineseBankBand.eligible?`${formatMoney(report.fx.chineseBankBand.lowerMinorUnits,report.fx.chineseBankBand.currency)} – ${formatMoney(report.fx.chineseBankBand.upperMinorUnits,report.fx.chineseBankBand.currency)}`:'Not eligible for an estimate band.'}</Copy><Copy dark={dark}>Estimate only · {report.fx.chineseBankBand.percentageBasisPoints/100}% · actual bank settlement may differ.</Copy></Card>:null}
      <Copy dark={dark} heading>Source coverage</Copy>{[...report.sourceCoverage].sort((a,b)=>a.source.localeCompare(b.source)).map(s=><Copy key={s.source} dark={dark}>{s.source}: {s.count}</Copy>)}
      <Copy dark={dark}>FX provider {report.fx.provider} · {report.fx.lockedDateCount} locked date(s) · {report.fx.earliest??'unavailable'} to {report.fx.latest??'unavailable'}</Copy>
    </>:state.phase==='ready'?<Copy dark={dark}>No report is available. Connect an account and refresh the owner snapshot.</Copy>:null}
  </View>;
}
export type ActivityProps=Theme&{state:LoadState<Transactions>;facetRows?:Transaction[];filters:Partial<ActivityQuery>;selected:Transaction|null;draft?:{category:string;note:string};mutation?:MutationState;onRetry():void;onFilter(value:Partial<ActivityQuery>):void;onOpen(id:string):void;onLoadMore():void;onClose():void;onDraft(value:{category:string;note:string}):void;onSave():void};
export function ActivityView({dark,state,facetRows=state.data?.items??[],filters,selected,draft={category:'',note:''},mutation={blocked:true,status:'checking'},onRetry,onFilter,onOpen,onLoadMore,onClose,onDraft,onSave}:ActivityProps) {
  const rows=state.data?.items??[],p=palette(dark);
  return <View style={styles.section}>
    <Copy dark={dark}>Server Activity pages; filters never convert unlike currencies.</Copy>
    <TextInput accessibilityLabel="Search merchant, account, status" placeholder="Search merchant, account, status" placeholderTextColor={p.muted} value={filters.query??''} onChangeText={query=>onFilter({...filters,query})} style={[styles.input,{color:p.text,borderColor:p.border}]} returnKeyType="search"/>
    {(['currency','category','status','source'] as const).map(key=><Choices key={key} dark={dark} label={key==='status'?'State':key[0].toUpperCase()+key.slice(1)} value={filters[key]??null} values={[...new Set(facetRows.map(t=>key==='source'?t.sourceLabel:t[key]).filter((v):v is string=>!!v))].sort()} onChange={value=>onFilter({...filters,[key]:value})}/>)}
    <Status dark={dark} state={state} onRetry={onRetry} label="Activity"/>
    {state.data&&filterActivity(rows,filters).length===0?<Copy dark={dark}>No activity matches this search.</Copy>:null}
    {filterActivity(rows,filters).map(t=><Card dark={dark} key={t.id}><Action dark={dark} label={`Open activity: ${t.merchant??'Merchant unavailable'}, ${t.currency} ${formatMoney(t.signedMinorUnits,t.currency)}`} onPress={()=>onOpen(t.id)}/><Copy dark={dark}>{t.occurredAt} · {t.status} · {t.kind}</Copy><Copy dark={dark}>{t.accountLabel??'Account unavailable'} · Source: {t.sourceLabel??'unavailable'}</Copy><Copy dark={dark}>{t.category??'Uncategorized'}</Copy></Card>)}
    {state.data?.nextCursor?<Action dark={dark} label="Load more Activity" onPress={onLoadMore} disabled={state.phase==='loading'}/>:null}
    {selected?<DetailModal dark={dark} title="Activity detail" onClose={onClose}>
      <Copy dark={dark}>{selected.merchant??'Merchant unavailable'} · {selected.currency} {formatMoney(selected.signedMinorUnits,selected.currency)}</Copy><Copy dark={dark}>{selected.occurredAt} · {selected.status} · {selected.kind}</Copy><Copy dark={dark}>Account: {selected.accountLabel??'unavailable'} · Source: {selected.sourceLabel??'unavailable'} · Revision {selected.revision}</Copy>
      <Copy dark={dark}>Category</Copy><TextInput accessibilityLabel="Category" value={draft.category} maxLength={80} onChangeText={category=>onDraft({...draft,category})} style={[styles.input,{color:p.text,borderColor:p.border}]}/>
      <Copy dark={dark}>Note</Copy><TextInput accessibilityLabel="Note" value={draft.note} multiline maxLength={1000} onChangeText={note=>onDraft({...draft,note})} style={[styles.input,{color:p.text,borderColor:p.border}]}/>
      <MutationStatus dark={dark} mutation={mutation}/><Copy dark={dark}>Source evidence and report values remain server-authoritative.</Copy>
      <Action dark={dark} label="Save annotation" onPress={onSave} disabled={mutation.blocked||mutation.status==='revision_conflict'||!draft.category.trim()}/><Action dark={dark} label="Close Activity detail" onPress={onClose}/>
    </DetailModal>:null}
  </View>;
}
export function MutationStatus({dark,mutation}:Theme&{mutation:MutationState}) {
  const message=mutationMessage(mutation.status);
  return message?<View accessibilityLiveRegion="polite"><Copy dark={dark} error={mutationError(mutation.status)}>{message}</Copy></View>:null;
}
const mutationMessages:Record<string,string>={
  revision_conflict:'This record changed elsewhere. Your draft is preserved; close and refresh before saving again.',
  rejected:'The server rejected this request. Refresh the data and review before trying again.',
  completed:'Saved. Refresh to read the current server revision.',
  ready:'',
  checking:'Checking native operation receipts…',
  saving:'Saving…',
  reconciliation_required:'The submitted operation needs reconciliation. Refresh status; do not submit it again.',
};
function mutationMessage(status:string){return mutationMessages[status]??mutationMessages.reconciliation_required;}
function mutationError(status:string){return status==='revision_conflict'||status==='rejected'||status==='reconciliation_required';}
export function RecurringView({dark,state,filters,currencies,onRetry,onFilter,onOpen,onLoadMore,selected,onClose,onClassify,mutation}:Theme&{state:LoadState<RecurringData>;filters:{currency?:string|null;classification?:string|null};currencies:string[];onRetry():void;onFilter(value:{currency?:string|null;classification?:string|null}):void;onOpen(id:string):void;onLoadMore():void;selected?:Stream|null;onClose?():void;onClassify?(classification:string):void;mutation?:MutationState}) {
  const page=state.data?.page,summary=state.data?.summary;
  const row=(s:Stream,support:string,key:string)=><Card dark={dark} key={key}><Action dark={dark} label={`Open recurring: ${s.merchantName??'Merchant unavailable'}`} onPress={()=>onOpen(s.id)}/><Copy dark={dark}>{s.currency} · {s.classification} · {s.frequency} · Source {s.sourceStatus}</Copy><Copy dark={dark}>Expected source amount: {s.averageAmountMinor===null?'unavailable':formatMoney(s.averageAmountMinor,s.currency)}</Copy><Copy dark={dark}>Next expected: {s.predictedNextDate??'unavailable'} · {support}</Copy></Card>;
  return <View style={styles.section}>
    <Copy dark={dark}>Expected commitments stay separate from actual posted cost.</Copy>
    <Choices dark={dark} label="Recurring currency" values={currencies} value={filters.currency??null} onChange={currency=>onFilter({...filters,currency})}/>
    <Choices dark={dark} label="Classification" values={['unclassified','subscription','bill','other','excluded']} value={filters.classification??null} onChange={classification=>onFilter({...filters,classification})}/>
    <Status dark={dark} state={state} onRetry={onRetry} label="Recurring"/>
    {page?<><Copy dark={dark}>{page.state} · Checked {page.checkedAt??'unavailable'} · Source updated {page.sourceUpdatedAt??'unavailable'}</Copy>{page.state!=='ready'||!page.items.length?<Copy dark={dark}>{recurringMessage(page.state)}</Copy>:null}{page.coverageWarnings.map((w,i)=><Copy key={i} dark={dark}>{w}</Copy>)}{page.lastError?<Copy dark={dark} error>Source error: {page.lastError}</Copy>:null}</>:null}
    {summary?<>
      <MoneyRows dark={dark} label="Expected monthly" values={summary.monthlyByCurrency}/><MoneyRows dark={dark} label="Expected yearly" values={summary.yearlyByCurrency}/><MoneyRows dark={dark} label="Subscriptions" values={summary.subscriptionByCurrency}/><MoneyRows dark={dark} label="Actual posted cost" values={summary.actualCostByCurrency}/>
      <Copy dark={dark}>{summary.state} · {summary.streamCount} stream(s) · Checked {summary.checkedAt??'unavailable'}</Copy>{summary.coverageWarnings.map((w,i)=><Copy dark={dark} key={i}>{w}</Copy>)}{summary.lastError?<Copy dark={dark} error>Source error: {summary.lastError}</Copy>:null}
      <Copy dark={dark} heading>Upcoming · next 30 days</Copy>{summary.upcoming.map((u,i)=>row(u.stream,`Expected ${u.nextExpectedAmountMinor===null?'amount unavailable':formatMoney(u.nextExpectedAmountMinor,u.stream.currency)}`,`upcoming-${i}`))}
      <Copy dark={dark} heading>Latest payment changes</Copy>{summary.latestPaymentChanges.map(s=>row(s,'Amount changed',`change-${s.id}`))}
    </>:null}
    {page?.items.map(s=>row(s,`Revision ${s.revision}`,s.id))}
    {page?.nextCursor?<Action dark={dark} label="Load more Recurring" disabled={state.phase==='loading'} onPress={onLoadMore}/>:null}
    {selected?<DetailModal dark={dark} title={selected.merchantName??'Merchant unavailable'} onClose={()=>onClose?.()}><Copy dark={dark}>{selected.currency} · {selected.classification} · Revision {selected.revision}</Copy><Copy dark={dark}>Classification</Copy><View style={styles.wrap}>{['unclassified','subscription','bill','other','excluded'].map(c=><Action key={c} dark={dark} label={`Classify as ${c}`} selected={selected.classification===c} disabled={(mutation?.blocked??true)||mutation?.status==='revision_conflict'} onPress={()=>onClassify?.(c)}/>)}</View>{mutation?<MutationStatus dark={dark} mutation={mutation}/>:null}<Action dark={dark} label="Close recurring selection" onPress={()=>onClose?.()}/></DetailModal>:null}
  </View>;
}
const styles=StyleSheet.create({
  section:{gap:12,marginTop:16},copy:{fontFamily:'DMSans',fontSize:15,lineHeight:23,flexShrink:1},heading:{fontFamily:'Newsreader',fontSize:24,lineHeight:30,marginTop:8},
  card:{padding:16,borderWidth:1,borderRadius:20,gap:8},wrap:{flexDirection:'row',flexWrap:'wrap',gap:8},action:{minHeight:48,borderWidth:1,borderRadius:16,paddingHorizontal:14,paddingVertical:10,justifyContent:'center',flexShrink:1},
  input:{minHeight:48,borderWidth:1,borderRadius:12,padding:12,fontFamily:'DMSans',fontSize:16},chart:{height:100,flexDirection:'row',borderBottomWidth:1,borderColor:'#68706D'},barColumn:{flex:1,height:100},bar:{position:'absolute',left:'15%',width:'70%'},
});
