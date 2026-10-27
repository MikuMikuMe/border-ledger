import React,{useEffect,useState} from 'react';
import {Pressable,StyleSheet,View} from 'react-native';
import {Action,Card,Copy} from '../finance/FinanceViews';
import {LunchFlowControls,type LunchFlowActions} from './LunchFlowControls';
import type {LunchFlowConnection} from '../../../../contracts/lunchflow';
import type {LunchFlowAccount,LunchFlowAccountKind,LunchFlowAccounts,LunchFlowSelection} from './contracts';
type LunchFlowDraft={selected:boolean;currency:string;kind:LunchFlowAccountKind};
const lunchFlowKinds:readonly LunchFlowAccountKind[]=['chequing','savings','credit'];
const emptyLunchFlow:LunchFlowAccounts={configured:false,accounts:[],connectionId:null,generation:null};
function lunchFlowDrafts(value:LunchFlowAccounts):Record<string,LunchFlowDraft>{
  return Object.fromEntries(value.accounts.map(account=>[account.providerAccountId,{
    selected:account.selected,
    currency:account.currency??account.currencies[0]??'',
    kind:account.kind??'chequing',
  }])) as Record<string,LunchFlowDraft>;
}
function LunchFlowAccountCard({dark,account,draft,disabled,onChange}:{dark:boolean;account:LunchFlowAccount;draft:LunchFlowDraft;disabled:boolean;onChange(value:LunchFlowDraft):void}){
  const currencyDisabled=disabled||!draft.selected;
  return <Card
      dark={dark}>
    <Pressable accessibilityRole="checkbox" accessibilityLabel={`${draft.selected?'Deselect':'Select'} Lunch Flow account ${account.name}`} accessibilityState={{checked:draft.selected,disabled:disabled||(!account.currencies.length&&!draft.selected)}}
      disabled={disabled||(!account.currencies.length&&!draft.selected)}
      onPress={()=>onChange({...draft,selected:!draft.selected})} style={styles.choice}>
      <Copy
      dark={dark} heading>{account.name}</Copy><Copy
      dark={dark}>{account.institution} · {draft.selected?'Selected':'Not selected'} · Provider account {account.providerAccountId}</Copy>
    </Pressable>
    <Copy
      dark={dark}>Currency</Copy>
    {!account.currencies.length?<Copy
      dark={dark}>No provider currencies are available for this account.</Copy>:<View style={styles.wrap}>{account.currencies.map(currency=><Action key={currency}
      dark={dark} label={`Lunch Flow currency ${currency}`} radio selected={draft.currency===currency}
      disabled={currencyDisabled}
      onPress={()=>onChange({...draft,currency})}/>)}</View>}
    <Copy
      dark={dark}>Kind</Copy><View style={styles.wrap}>{lunchFlowKinds.map(kind=><Action key={kind}
      dark={dark} label={`Lunch Flow kind ${kind}`} radio selected={draft.kind===kind}
      disabled={currencyDisabled}
      onPress={()=>onChange({...draft,kind})}/>)}</View>
    <Copy
      dark={dark}>Last sync {account.lastSyncedAt??'not synced yet'}</Copy>{account.lastError?<Copy
      dark={dark} error>Provider status: {account.lastError}</Copy>:null}
  </Card>;
}
function draftForLunchFlowAccount(account:LunchFlowAccount,drafts:Record<string,LunchFlowDraft>):LunchFlowDraft{
  return drafts[account.providerAccountId]??{selected:false,currency:account.currencies[0]??'',kind:'chequing'};
}
function lunchFlowSelections(accounts:LunchFlowAccount[],drafts:Record<string,LunchFlowDraft>):LunchFlowSelection[]{
  return accounts.flatMap(account=>{
    const draft=drafts[account.providerAccountId];
    if(!draft?.selected||!draft.currency)return [];
    return [{providerAccountId:account.providerAccountId,currency:draft.currency,kind:draft.kind}];
  });
}
function hasInvalidLunchFlowSelection(accounts:LunchFlowAccount[],drafts:Record<string,LunchFlowDraft>):boolean{
  return accounts.some(account=>{
    const draft=drafts[account.providerAccountId];
    if(!draft?.selected||!account.currencies.length)return false;
    return !draft.currency||!account.currencies.includes(draft.currency);
  });
}
function LunchFlowConfigured({dark,value,drafts,disabled,onChange,onSave,onSync}:{dark:boolean;value:LunchFlowAccounts;drafts:Record<string,LunchFlowDraft>;disabled:boolean;onChange(account:LunchFlowAccount,draft:LunchFlowDraft):void;onSave(selections:LunchFlowSelection[]):void;onSync():void}){
  const selections=lunchFlowSelections(value.accounts,drafts),invalid=hasInvalidLunchFlowSelection(value.accounts,drafts);
  return <>
    <Copy
      dark={dark}>{selections.length} selected · Provider accounts are discovered from Lunch Flow.</Copy>
    {value.accounts.length?value.accounts.map(account=><LunchFlowAccountCard key={account.providerAccountId}
      dark={dark} account={account} draft={draftForLunchFlowAccount(account,drafts)}
      disabled={disabled}
      onChange={draft=>onChange(account,draft)}/>):<Copy
      dark={dark}>No Lunch Flow accounts were discovered.</Copy>}
    <Action
      dark={dark} label="Save Lunch Flow selection"
      disabled={disabled||invalid}
      onPress={()=>onSave(selections)}/>
    <Action
      dark={dark} label="Refresh Lunch Flow"
      disabled={disabled}
      onPress={onSync}/>
    <Copy
      dark={dark}>Refresh requests are queued. Imported history appears after a completed refresh.</Copy>
  </>;
}
export function LunchFlowSection({dark,value,connection,actions,disabled,onSave,onSync}:{connection:LunchFlowConnection|undefined;actions:LunchFlowActions;dark:boolean;value:LunchFlowAccounts|undefined;disabled:boolean;onSave(selections:LunchFlowSelection[]):void;onSync():void}){
  const lunchFlow=value??emptyLunchFlow,[drafts,setDrafts]=useState<Record<string,LunchFlowDraft>>(()=>lunchFlowDrafts(lunchFlow));
  useEffect(()=>{setDrafts(lunchFlowDrafts(lunchFlow));},[lunchFlow]);
  const update=(account:LunchFlowAccount,draft:LunchFlowDraft)=>setDrafts(current=>({...current,[account.providerAccountId]:draft}));
  return <View style={styles.section}>
    <Copy
      dark={dark} heading>Lunch Flow</Copy>
    <LunchFlowControls
      dark={dark} value={connection}
      disabled={disabled} actions={actions}/>
    {connection?.connected&&lunchFlow.configured?<LunchFlowConfigured
      dark={dark} value={lunchFlow} drafts={drafts}
      disabled={disabled}
      onChange={update} onSave={onSave} onSync={onSync}/>:null}
  </View>;
}

const styles=StyleSheet.create({section:{marginTop:16,gap:12},wrap:{flexDirection:'row',flexWrap:'wrap',gap:8},choice:{minHeight:48,padding:12,borderWidth:1,borderColor:'#68706D',borderRadius:12}});
