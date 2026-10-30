import React,{useEffect,useRef,useState} from 'react';
import {AccessibilityInfo,ActivityIndicator,findNodeHandle,KeyboardAvoidingView,Modal,Pressable,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import type {ActivityQuery,Report,Snapshot,Transaction,Transactions,Stream,Lens,RecurringData,MutationState} from './contracts';
import {comparableTotals,fillReportDays,filterActivity,formatMoney,recurringMessage,reportingCurrencies,reportView,type LoadState,type Window} from './model';

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
export function LedgerRow({dark,label,title,amount,details,onPress}:Theme&{label:string;title:string;amount?:string;details:string[];onPress():void}) {
  const p=palette(dark);
  return <Pressable accessibilityRole="button" accessibilityLabel={[label,amount,...details].filter(Boolean).join(' · ')} onPress={onPress} style={({pressed})=>[styles.ledgerRow,{borderColor:p.border},pressed&&styles.rowPressed]}>
    <View style={styles.ledgerTop}><Text style={[styles.ledgerTitle,{color:p.text}]}>{title}</Text>{amount?<Text style={[styles.ledgerAmount,{color:p.text}]}>{amount}</Text>:null}</View>
    {details.map((detail,index)=><Text key={index} style={[styles.ledgerMeta,{color:p.muted}]}>{detail}</Text>)}
  </Pressable>;
}
function Choices({dark,label,values,value,onChange}:Theme&{label:string;values:string[];value:string|null;onChange(value:string|null):void}) {
  return <View style={styles.section}><Copy dark={dark} heading>{label}</Copy><ScrollView horizontal contentContainerStyle={{gap:8}}>{[null,...new Set([...(value?[value]:[]),...values])].map(v=><Action key={v??'all'} dark={dark} label={`${label}: ${v??'All'}`} text={v??'All'} selected={v===value} radio onPress={()=>onChange(v)}/>)}</ScrollView></View>;
}
function FilterDisclosure({dark,label,summary,children}:Theme&{label:string;summary:string;children:React.ReactNode}) {
  const [expanded,setExpanded]=useState(false),p=palette(dark);
  return <View>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{expanded}} onPress={()=>setExpanded(!expanded)} style={{minHeight:48,paddingVertical:12}}>
      <Text style={[styles.disclosureLabel,{color:p.accent}]}>{expanded?'Hide':'Show'} {label.toLowerCase()}</Text>
      <Text style={[styles.reportNote,{color:p.muted}]}>{summary}</Text>
    </Pressable>
    {expanded?children:null}
  </View>;
}
export function Status({dark,state,onRetry,label}:Theme&{state:LoadState<unknown>;onRetry():void;label:string}) {
  if(state.phase==='ready'&&!state.message)return <Pressable accessibilityRole="button" accessibilityLabel={`Refresh ${label}`} accessibilityState={{disabled:false}} disabled={false} onPress={onRetry} style={styles.quietRefresh}><Text style={[styles.disclosureLabel,{color:palette(dark).accent}]}>Refresh {label}</Text></Pressable>;
  return <View style={styles.status} accessibilityLiveRegion="polite" accessibilityRole={state.message?'alert':undefined}>
    {state.phase==='loading'?<><ActivityIndicator accessibilityLabel={`Loading ${label}`} color={palette(dark).accent}/><Copy dark={dark}>Loading {label}…</Copy></>:null}
    {state.message?<Copy dark={dark} error>{state.message}</Copy>:null}
    <Action dark={dark} label={`Refresh ${label}`} onPress={onRetry} disabled={state.phase==='loading'}/>
  </View>;
}
function MoneyRows({dark,label,values,featured=false}:Theme&{label:string;values:{currency:string;amountMinor:string}[];featured?:boolean}) {
  const p=palette(dark);
  return <View style={[styles.card,featured&&styles.featuredTotal,{backgroundColor:featured?(dark?'#203B33':'#E3ECE4'):p.surface,borderColor:p.border}]}><Text accessibilityRole="header" style={[styles.copy,{color:p.text}]}>{label}</Text>{values.length?values.map(v=><Text key={v.currency} style={[styles.total,{color:p.text}]}>{formatMoney(v.amountMinor,v.currency)} <Text style={styles.currency}>{v.currency}</Text></Text>):<Copy dark={dark}>No supported amount is available.</Copy>}</View>;
}
function shortDate(value:string|null) {
  if(!value)return null;
  const date=new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime())?value:new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(date);
}
function RecurringMoneySummary({dark,summary}:Theme&{summary:RecurringData['summary']}) {
  if(!summary)return null;
  const groups=[{label:'Expected monthly',values:summary.monthlyByCurrency},{label:'Expected yearly',values:summary.yearlyByCurrency},{label:'Subscriptions',values:summary.subscriptionByCurrency},{label:'Actual posted cost',values:summary.actualCostByCurrency}];
  const p=palette(dark);
  return <Card dark={dark}>{groups.map((group,index)=><View key={group.label} style={[styles.moneySummaryRow,index>0&&{borderTopWidth:1,borderColor:p.border}]}>
    <Text accessibilityRole="header" style={[styles.copy,{color:p.muted}]}>{group.label}</Text>
    {group.values.length?group.values.map(value=><Text key={value.currency} style={[styles.moneySummaryValue,{color:p.text}]}>{formatMoney(value.amountMinor,value.currency)} {value.currency}</Text>):<Text style={[styles.ledgerMeta,{color:p.muted}]}>Unavailable</Text>}
  </View>)}</Card>;
}
type TrendLane=ReturnType<typeof reportView>['lanes'][number];
type TrendPoint=TrendLane['points'][number];
function TrendBar({dark,point,currency,max,active,highest,onSelect}:Theme&{point:TrendPoint;currency:string;max:bigint;active:boolean;highest:boolean;onSelect():void}) {
  const p=palette(dark),value=BigInt(point.amount),negative=value<0n,absolute=negative?-value:value,height=Number(absolute*100n/max);
  return <Pressable accessibilityRole="button" accessibilityLabel={`${shortDate(point.date)}, ${currency}, ${formatMoney(point.amount,currency)}${highest?', highest spending day':''}`} accessibilityState={{selected:active}} onPress={onSelect} style={[styles.barColumn,{borderColor:active?p.accent:'transparent'}]}><View style={[styles.bar,{height:Math.max(2,height/2),backgroundColor:negative?p.error:p.accent,opacity:active||highest?1:0.55,top:negative?50:50-height/2}]}/></Pressable>;
}
function DailyBreakdown({dark,lane,include}:Theme&{lane:TrendLane;include:boolean}) {
  const p=palette(dark);
  return <FilterDisclosure dark={dark} label="Daily breakdown" summary={`${lane.points.length} days`}>{lane.points.map(point=><View key={point.date} accessible accessibilityLabel={`${point.date}, ${lane.currency}, ${formatMoney(point.amount,lane.currency)}, confirmed ${formatMoney(point.confirmed,lane.currency)}${include?`, provisional ${formatMoney(point.provisional,lane.currency)}`:''}`} style={[styles.dailyRow,{borderColor:p.border}]}><Text style={[styles.copy,{color:p.text}]}>{point.date}</Text><Text style={[styles.copy,styles.dailyAmount,{color:p.text}]}>{formatMoney(point.amount,lane.currency)}</Text>{include?<Text style={[styles.reportNote,{color:p.muted}]}>Confirmed {formatMoney(point.confirmed,lane.currency)} · Provisional {formatMoney(point.provisional,lane.currency)}</Text>:null}</View>)}</FilterDisclosure>;
}
function trendSelection(lane:TrendLane,selected:string|null) {
  const highest=lane.points.reduce<TrendPoint|null>((best,point)=>BigInt(point.amount)>0n&&(!best||BigInt(point.amount)>BigInt(best.amount))?point:best,null);
  const current=lane.points.find(point=>point.date===selected)??highest??lane.points[0];
  const max=lane.points.reduce((m,point)=>{const value=BigInt(point.amount),absolute=value<0n?-value:value;return absolute>m?absolute:m;},1n);
  return {highest,current,max};
}
function TrendSummary({dark,current,highest,selected,currency}:Theme&{current:TrendPoint;highest:TrendPoint|null;selected:string|null;currency:string}) {
  const p=palette(dark),isHighest=current.date===highest?.date;
  const label=isHighest?'Highest day':selected?'Selected day':'First day';
  return <View accessible accessibilityLiveRegion="polite" accessibilityLabel={`${current.date}, ${currency}, ${formatMoney(current.amount,currency)}${isHighest?', highest spending day':''}`}><Text style={[styles.trendSummary,{color:p.text}]}>{label} · {shortDate(current.date)}</Text><Text style={[styles.trendAmount,{color:p.text}]}>{formatMoney(current.amount,currency)}</Text></View>;
}
function usePeakScroll(lane:TrendLane,highest:TrendPoint|null) {
  const scroll=useRef<React.ElementRef<typeof ScrollView>>(null);
  const index=lane.points.findIndex(point=>point.date===highest?.date);
  useEffect(()=>{if(index>=0)scroll.current?.scrollTo({x:Math.max(0,index*48-96),animated:false});},[index,lane.currency]);
  return scroll;
}
function TrendChart({dark,lane,include,converted}:Theme&{lane:TrendLane;include:boolean;converted:boolean}) {
  const [selected,setSelected]=useState<string|null>(null),p=palette(dark);
  const {highest,current,max}=trendSelection(lane,selected),scroll=usePeakScroll(lane,highest);
  return <Card dark={dark}>
    <Text style={[styles.laneTitle,{color:p.text}]}>{lane.currency} <Text style={[styles.reportNote,{color:p.muted}]}>· {converted?'Converted':'Source currency'}</Text></Text>
    {current?<TrendSummary dark={dark} current={current} highest={highest} selected={selected} currency={lane.currency}/>:null}
    <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.chartScroll}>
      <View style={styles.chartContent}><View style={styles.chart}><View style={[styles.chartBaseline,{borderColor:p.border}]}/>{lane.points.map(point=><TrendBar key={point.date} dark={dark} point={point} currency={lane.currency} max={max} active={Boolean(selected||highest)&&point.date===current?.date} highest={point.date===highest?.date} onSelect={()=>setSelected(point.date)}/>)}</View>
      <View style={styles.chartDates}><Text style={[styles.reportNote,{color:p.muted}]}>{shortDate(lane.points[0]?.date??null)}</Text><Text style={[styles.reportNote,{color:p.muted}]}>{shortDate(lane.points[lane.points.length-1]?.date??null)}</Text></View></View>
    </ScrollView>
    <DailyBreakdown dark={dark} lane={lane} include={include}/>
  </Card>;
}
function PeriodComparison({dark,current,previous,lens}:Theme&{current:Report;previous:Report;lens:Lens}) {
  const values=comparableTotals(current,previous,lens.include,lens.source),p=palette(dark);
  if(!values.length)return null;
  return <View style={[styles.comparison,{borderColor:p.border}]}><Text accessibilityRole="header" style={[styles.laneTitle,{color:p.text}]}>Previous period</Text><Text style={[styles.reportNote,{color:p.muted}]}>{shortDate(previous.from)} – {shortDate(previous.to)} · recorded spending</Text><Text style={[styles.reportNote,{color:p.muted}]}>Account coverage may differ between periods.</Text>{values.map(value=>{const delta=BigInt(value.difference);return <Text key={value.currency} style={[styles.copy,{color:p.text}]}>{value.currency} · {formatMoney(value.previous,value.currency)} · {delta===0n?'No change':`${formatMoney((delta<0n?-delta:delta).toString(),value.currency)} ${delta>0n?'more':'less'}`}</Text>;})}</View>;
}
export function OverviewView({dark,state,previous,snapshot,lens,currencies,onLens,onRetry}:Theme&{state:LoadState<Report>;previous?:LoadState<Report>;snapshot:Snapshot|null;lens:Lens;currencies:string[];onLens(value:Lens):void;onRetry():void}) {
  const report=state.data,view=report?reportView(report,lens.include,lens.source):null;
  const reportFilters = <FilterDisclosure dark={dark} label="Report filters" summary={`${lens.source??'All currencies'} · ${lens.target??'No conversion'} · ${lens.include?'Including provisional':'Confirmed only'}`}><Action dark={dark} label="Include provisional" selected={lens.include} onPress={()=>onLens({...lens,include:!lens.include})}/>
    <Choices dark={dark} label="Source currency (no conversion)" values={currencies} value={lens.source} onChange={source=>onLens({...lens,source})}/>
    <Choices dark={dark} label="Reporting currency" values={reportingCurrencies} value={lens.target} onChange={target=>onLens({...lens,target})}/></FilterDisclosure>;
  return <View style={styles.overview}>
    <View style={styles.periods}>{(['Today','Week','Month'] as Window[]).map(window=><Action key={window} dark={dark} label={`Report window: ${window}`} text={window} selected={window===lens.window} radio onPress={()=>onLens({...lens,window})}/>)}</View>

    {state.phase!=='ready'||!report?<Status dark={dark} state={state} onRetry={onRetry} label="report"/>:null}
    {!report?reportFilters:null}
    {report&&view?<>
      <Text style={[styles.reportPeriod,{color:palette(dark).muted}]}>{shortDate(report.from)??'Full history'}  –  {shortDate(report.to)??'today'}</Text>
      {report.reportingCurrency?<Copy dark={dark} error={!report.fx.complete}>{report.fx.complete?'Locked to purchase dates using Frankfurter daily rates.':`Partial conversion. Unavailable source currencies: ${report.fx.unavailableSourceCurrencies.join(', ')||'see source audit'}.`}</Copy>:null}
      <MoneyRows dark={dark} featured label={`Net spending ${lens.window==='Today'?'today':lens.window==='Week'?'this week':'this month'}${report.reportingCurrency?' · converted':''}`} values={view.totals.map(v=>({currency:v.currency,amountMinor:v.amount}))}/>
      <Text style={[styles.reportNote,{color:palette(dark).muted}]}>{lens.include?'Includes provisional activity':'Confirmed activity only'}{report.reviewCount?` · ${report.reviewCount} need review`:''}</Text>
      <Text style={[styles.sectionHeading,{color:palette(dark).text}]} accessibilityRole="header">Spending over time</Text>
      {view.unavailable?<Copy dark={dark} error>Chart unavailable: conversion rates are not available for the locked purchase dates.</Copy>:null}
      {!view.lanes.length&&!view.unavailable?<Copy dark={dark}>No daily totals are available for this reporting lens.</Copy>:null}
      {view.lanes.map(lane=><TrendChart key={lane.currency} dark={dark} lane={report.reportingCurrency&&!report.fx.complete?lane:fillReportDays(lane,report.from,report.to)} include={lens.include} converted={Boolean(report.reportingCurrency)}/>)}
      {state.phase==='ready'&&previous?.phase==='ready'&&previous.data?<PeriodComparison dark={dark} current={report} previous={previous.data} lens={lens}/>:null}
      {previous&&['offline','error','locked'].includes(previous.phase)?<Text style={[styles.reportNote,{color:palette(dark).muted}]}>Previous period unavailable. Refresh the report to try again.</Text>:null}
      {report.reportingCurrency?<MoneyRows dark={dark} label="Source currency audit" values={view.sourceTotals.map(v=>({currency:v.currency,amountMinor:v.amount}))}/>:null}
      {report.fx.chineseBankBand?<Card dark={dark}><Copy dark={dark} heading>Chinese bank estimate band</Copy><Copy dark={dark}>{report.fx.chineseBankBand.eligible?`${formatMoney(report.fx.chineseBankBand.lowerMinorUnits,report.fx.chineseBankBand.currency)} – ${formatMoney(report.fx.chineseBankBand.upperMinorUnits,report.fx.chineseBankBand.currency)}`:'Not eligible for an estimate band.'}</Copy><Copy dark={dark}>Estimate only · {report.fx.chineseBankBand.percentageBasisPoints/100}% · actual bank settlement may differ.</Copy></Card>:null}
      {reportFilters}
      {state.phase==='ready'&&!state.message?<Status dark={dark} state={state} onRetry={onRetry} label="report"/>:null}
      <FilterDisclosure dark={dark} label="Report details" summary="Dates, coverage and exclusions"><Copy dark={dark}>Server snapshot only; unsent capture records are not included.</Copy><Copy dark={dark}>As of {report.asOf??'unavailable'} · {report.timeBasis} · {report.timeZone??snapshot?.timeZone??'Timezone unavailable'}</Copy>{snapshot?<Copy dark={dark}>Snapshot {snapshot.snapshotAt} · {snapshot.accounts.length} account(s)</Copy>:null}<Copy dark={dark}>Excluded: {report.excludedCount}</Copy><Copy dark={dark} heading>Source coverage</Copy>{[...report.sourceCoverage].sort((a,b)=>a.source.localeCompare(b.source)).map(s=><Copy key={s.source} dark={dark}>{s.source}: {s.count}</Copy>)}
      <Copy dark={dark}>FX provider {report.fx.provider} · {report.fx.lockedDateCount} locked date(s) · {report.fx.earliest??'unavailable'} to {report.fx.latest??'unavailable'}</Copy></FilterDisclosure>
    </>:state.phase==='ready'?<Copy dark={dark}>No report is available. Connect an account and refresh the owner snapshot.</Copy>:null}
  </View>;
}
export type ActivityProps=Theme&{state:LoadState<Transactions>;facetRows?:Transaction[];filters:Partial<ActivityQuery>;selected:Transaction|null;draft?:{category:string;note:string};mutation?:MutationState;onRetry():void;onFilter(value:Partial<ActivityQuery>):void;onOpen(id:string):void;onLoadMore():void;onClose():void;onDraft(value:{category:string;note:string}):void;onSave():void};
type ActivityFacetName='currency'|'category'|'status'|'source';
const activityFacetNames:ActivityFacetName[]=['currency','category','status','source'];
function activityFacetLabel(name:ActivityFacetName){return name==='status'?'State':name[0].toUpperCase()+name.slice(1);}
function activityFacetValue(transaction:Transaction,name:ActivityFacetName){return name==='source'?transaction.sourceLabel:transaction[name];}
function ActivityFacet({dark,facetRows,filters,onFilter,name}:{dark:boolean;facetRows:Transaction[];filters:Partial<ActivityQuery>;onFilter(value:Partial<ActivityQuery>):void;name:ActivityFacetName}){
  const values=[...new Set(facetRows.map(transaction=>activityFacetValue(transaction,name)).filter((value):value is string=>!!value))].sort();
  return <Choices dark={dark} label={activityFacetLabel(name)} value={filters[name]??null} values={values} onChange={value=>onFilter({...filters,[name]:value})}/>;
}
function ActivityFilters({dark,facetRows,filters,onFilter}:{dark:boolean;facetRows:Transaction[];filters:Partial<ActivityQuery>;onFilter(value:Partial<ActivityQuery>):void}){
  const p=palette(dark);
  return <>
    <TextInput accessibilityLabel="Search merchant, account, status" placeholder="Search merchant, account, status" placeholderTextColor={p.muted} value={filters.query??''} onChangeText={query=>onFilter({...filters,query})} style={[styles.input,{color:p.text,borderColor:p.border}]} returnKeyType="search"/>
    <FilterDisclosure dark={dark} label="Activity filters" summary={`${activityFacetNames.filter(name=>filters[name]).length} active`}>{activityFacetNames.map(name=><ActivityFacet key={name} dark={dark} facetRows={facetRows} filters={filters} onFilter={onFilter} name={name}/>)}</FilterDisclosure>
  </>;
}
function ActivityRow({dark,transaction,onOpen}:{dark:boolean;transaction:Transaction;onOpen(id:string):void}){
  const title=transaction.merchant??'Merchant unavailable';
  return <LedgerRow dark={dark} label={`Open activity: ${title}`} title={title} amount={`${formatMoney(transaction.signedMinorUnits,transaction.currency)} ${transaction.currency}`} details={[`${transaction.occurredAt} · ${transaction.status} · ${transaction.kind}`,`Account: ${transaction.accountLabel??'unavailable'} · Source: ${transaction.sourceLabel??'unavailable'} · Category: ${transaction.category??'Uncategorized'}`]} onPress={()=>onOpen(transaction.id)}/>;
}
function ActivityResults({dark,state,rows,onLoadMore,onOpen}:{dark:boolean;state:LoadState<Transactions>;rows:Transaction[];onLoadMore():void;onOpen(id:string):void}){
  return <>
    {state.data&&rows.length===0?<Copy dark={dark}>No activity matches this search.</Copy>:null}
    {rows.map(transaction=><ActivityRow key={transaction.id} dark={dark} transaction={transaction} onOpen={onOpen}/>)}
    {state.data?.nextCursor?<Action dark={dark} label="Load more Activity" onPress={onLoadMore} disabled={state.phase==='loading'}/>:null}
  </>;
}
function ActivityDetail({dark,selected,draft,mutation,onDraft,onSave,onClose}:{dark:boolean;selected:Transaction;draft:{category:string;note:string};mutation:MutationState;onDraft(value:{category:string;note:string}):void;onSave():void;onClose():void}){
  const p=palette(dark);
  return <DetailModal dark={dark} title="Activity detail" onClose={onClose}>
    <Copy dark={dark}>{selected.merchant??'Merchant unavailable'} · {selected.currency} {formatMoney(selected.signedMinorUnits,selected.currency)}</Copy>
    <Copy dark={dark}>{selected.occurredAt} · {selected.status} · {selected.kind}</Copy>
    <Copy dark={dark}>Account: {selected.accountLabel??'unavailable'} · Source: {selected.sourceLabel??'unavailable'} · Revision {selected.revision}</Copy>
    <Copy dark={dark}>Category</Copy><TextInput accessibilityLabel="Category" value={draft.category} maxLength={80} onChangeText={category=>onDraft({...draft,category})} style={[styles.input,{color:p.text,borderColor:p.border}]}/>
    <Copy dark={dark}>Note</Copy><TextInput accessibilityLabel="Note" value={draft.note} multiline maxLength={1000} onChangeText={note=>onDraft({...draft,note})} style={[styles.input,{color:p.text,borderColor:p.border}]}/>
    <MutationStatus dark={dark} mutation={mutation}/><Copy dark={dark}>Source evidence and report values remain server-authoritative.</Copy>
    <Action dark={dark} label="Save annotation" onPress={onSave} disabled={mutation.blocked||mutation.status==='revision_conflict'||!draft.category.trim()}/><Action dark={dark} label="Close Activity detail" onPress={onClose}/>
  </DetailModal>;
}
export function ActivityView({dark,state,facetRows=state.data?.items??[],filters,selected,draft={category:'',note:''},mutation={blocked:true,status:'checking'},onRetry,onFilter,onOpen,onLoadMore,onClose,onDraft,onSave}:ActivityProps) {
  const rows=state.data?.items??[],visibleRows=filterActivity(rows,filters);
  return <View style={styles.section}>
    <Copy dark={dark}>Server Activity pages; filters never convert unlike currencies.</Copy>
    <ActivityFilters dark={dark} facetRows={facetRows} filters={filters} onFilter={onFilter}/>
    <Status dark={dark} state={state} onRetry={onRetry} label="Activity"/>
    <ActivityResults dark={dark} state={state} rows={visibleRows} onLoadMore={onLoadMore} onOpen={onOpen}/>
    {selected?<ActivityDetail dark={dark} selected={selected} draft={draft} mutation={mutation} onDraft={onDraft} onSave={onSave} onClose={onClose}/>:null}
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
  const row=(s:Stream,support:string,key:string)=><LedgerRow dark={dark} key={key} label={`Open recurring: ${s.merchantName??'Merchant unavailable'}`} title={s.merchantName??'Merchant unavailable'} amount={s.averageAmountMinor===null?'Unavailable':formatMoney(s.averageAmountMinor,s.currency)} details={[`${s.currency} · ${s.classification} · ${s.frequency} · Source ${s.sourceStatus}`,`Next expected: ${s.predictedNextDate??'unavailable'} · ${support}`]} onPress={()=>onOpen(s.id)}/>;
  return <View style={styles.section}>
    <Copy dark={dark}>Expected commitments stay separate from actual posted cost.</Copy>
    <FilterDisclosure dark={dark} label="Recurring filters" summary={`${filters.currency??'All currencies'} / ${filters.classification??'All classifications'}`}><Choices dark={dark} label="Recurring currency" values={currencies} value={filters.currency??null} onChange={currency=>onFilter({...filters,currency})}/>
    <Choices dark={dark} label="Classification" values={['unclassified','subscription','bill','other','excluded']} value={filters.classification??null} onChange={classification=>onFilter({...filters,classification})}/></FilterDisclosure>
    <Status dark={dark} state={state} onRetry={onRetry} label="Recurring"/>
    {page?<><Copy dark={dark}>{page.state} · Checked {page.checkedAt??'unavailable'} · Source updated {page.sourceUpdatedAt??'unavailable'}</Copy>{page.state!=='ready'||!page.items.length?<Copy dark={dark}>{recurringMessage(page.state)}</Copy>:null}{page.coverageWarnings.map((w,i)=><Copy key={i} dark={dark}>{w}</Copy>)}{page.lastError?<Copy dark={dark} error>Source error: {page.lastError}</Copy>:null}</>:null}
    {summary?<>
      <RecurringMoneySummary dark={dark} summary={summary}/>
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
  moneySummaryRow:{paddingVertical:12,gap:4},moneySummaryValue:{fontFamily:'DMSans',fontSize:18,lineHeight:25,fontWeight:'600',fontVariant:['tabular-nums']},
  quietRefresh:{minHeight:48,alignSelf:'flex-start',justifyContent:'center',paddingVertical:8},status:{gap:12,marginVertical:8},
  ledgerRow:{minHeight:64,paddingVertical:14,borderBottomWidth:1,gap:4},ledgerTop:{flexDirection:'row',justifyContent:'space-between',alignItems:'baseline',gap:12},ledgerTitle:{fontFamily:'DMSans',fontSize:17,lineHeight:24,fontWeight:'600',flexShrink:1},ledgerAmount:{fontFamily:'DMSans',fontSize:16,lineHeight:24,fontWeight:'600',fontVariant:['tabular-nums'],flexShrink:1,textAlign:'right'},ledgerMeta:{fontFamily:'DMSans',fontSize:13,lineHeight:20},rowPressed:{opacity:0.65},
  dailyRow:{flexDirection:'row',flexWrap:'wrap',justifyContent:'space-between',gap:4,paddingVertical:8,borderBottomWidth:StyleSheet.hairlineWidth},dailyAmount:{fontVariant:['tabular-nums']},
  disclosureLabel:{fontFamily:'DMSans',fontSize:15,lineHeight:22,fontWeight:'600'},
  overview:{gap:10,marginTop:12},periods:{flexDirection:'row',flexWrap:'wrap',gap:8},reportPeriod:{fontFamily:'DMSans',fontSize:14,lineHeight:20,marginTop:4},reportNote:{fontFamily:'DMSans',fontSize:13,lineHeight:20},sectionHeading:{fontFamily:'DMSans',fontSize:21,lineHeight:28,fontWeight:'600',marginTop:20},laneTitle:{fontFamily:'DMSans',fontSize:16,lineHeight:24,fontWeight:'600'},chartDates:{flexDirection:'row',justifyContent:'space-between'},
  featuredTotal:{padding:20,gap:10},comparison:{borderTopWidth:1,paddingTop:14,gap:5},trendSummary:{fontFamily:'DMSans',fontSize:14,lineHeight:20,fontWeight:'600'},trendAmount:{fontFamily:'DMSans',fontSize:22,lineHeight:30,fontWeight:'600',fontVariant:['tabular-nums']},chartScroll:{flexGrow:1},chartContent:{flexGrow:1,gap:8},
  total:{fontFamily:'DMSans',fontSize:30,lineHeight:40,fontWeight:'600',fontVariant:['tabular-nums']},currency:{fontSize:15,fontWeight:'400'},
  section:{gap:12,marginTop:16},copy:{fontFamily:'DMSans',fontSize:15,lineHeight:23,flexShrink:1},heading:{fontFamily:'DMSans',fontSize:21,lineHeight:28,fontWeight:'600',marginTop:12},
  card:{padding:16,borderWidth:1,borderRadius:14,gap:8},wrap:{flexDirection:'row',flexWrap:'wrap',gap:8},action:{minHeight:48,borderWidth:1,borderRadius:8,paddingHorizontal:14,paddingVertical:10,justifyContent:'center',flexShrink:1},
  input:{minHeight:48,borderWidth:1,borderRadius:12,padding:12,fontFamily:'DMSans',fontSize:16},chart:{height:100,flexDirection:'row',flexGrow:1},chartBaseline:{position:'absolute',left:0,right:0,top:50,borderTopWidth:1},barColumn:{flex:1,minWidth:48,height:100,borderWidth:1,borderRadius:4},bar:{position:'absolute',left:'15%',width:'70%'},
});
