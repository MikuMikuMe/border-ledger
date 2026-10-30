import React,{useEffect,useState} from 'react';
import {Pressable,Text,TextInput,View} from 'react-native';
import {Action,Card,Copy,DetailModal,Status} from '../finance/FinanceViews';
import {formatMoney,reportingCurrencies} from '../finance/model';
import {ToolsController,canAuthorize,canCommit} from './ToolsController';
import type {CaptureSnapshot,Device,FileSnapshot,ReportingUpdate,RuntimeHealth} from './contracts';

type Props={dark:boolean;controller:ToolsController;operationId():string;onCapture?():void};
type CaptureState=ReturnType<ToolsController['capture']['current']>;
type RowsState=ReturnType<ToolsController['rows']['current']>;
type AccountState=ReturnType<ToolsController['accounts']['current']>;
type CaptureDetailsProps={dark:boolean;controller:ToolsController;snapshot:CaptureSnapshot;state:CaptureState;consent:boolean;setConsent(value:boolean):void;operationId():string};
type PreviewProps={dark:boolean;controller:ToolsController;snapshot:FileSnapshot;rows:RowsState;ready:boolean;draftReady:boolean;operationId():string;onReview():void};

const stack={gap:12,marginTop:18};
const blocked=(controller:ToolsController)=>controller.mutation.current().blocked||controller.mutation.current().status==='revision_conflict';
const ready=(phase:string)=>phase==='ready';

const toolColors=(dark:boolean)=>dark?{text:'#EEF1E8',muted:'#B1BDB5',surface:'#1D2925',border:'#43534B',accent:'#83C9B1'}:{text:'#18201F',muted:'#4F5C56',surface:'#FBF9F4',border:'#D2CCC0',accent:'#1B6B5B'};
function ToolSection({dark,title,children}: {dark:boolean;title:string;children:React.ReactNode}){
 const p=toolColors(dark);
 return <View style={{padding:16,borderWidth:1,borderRadius:14,borderColor:p.border,backgroundColor:p.surface,gap:12}}><Text accessibilityRole="header" style={{fontFamily:'DMSans',fontSize:19,lineHeight:26,fontWeight:'600',color:p.text}}>{title}</Text>{children}</View>;
}
function ToolLabel({dark,children}:{dark:boolean;children:React.ReactNode}){
 return <Text style={{fontFamily:'DMSans',fontSize:14,lineHeight:21,color:toolColors(dark).muted}}>{children}</Text>;
}

function Check({dark,label,checked,onPress,disabled=false}:{dark:boolean;label:string;checked:boolean;onPress():void;disabled?:boolean}){
 return <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{checked,disabled}} disabled={disabled} onPress={onPress} style={{minHeight:48,borderWidth:1,borderRadius:12,borderColor:dark?'#43534B':'#D2CCC0',padding:12,justifyContent:'center',opacity:disabled?0.6:1}}><Text style={{color:dark?'#EEF1E8':'#18201F',fontFamily:'DMSans',fontSize:15}}>{label} · {checked?'On':'Off'}</Text></Pressable>;
}

function Field({dark,label,value,onChange}:{dark:boolean;label:string;value:string;onChange(v:string):void}){
 return <View style={{gap:6}}><Copy dark={dark}>{label}</Copy><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} autoCapitalize="none" style={{minHeight:48,padding:12,borderWidth:1,borderRadius:12,borderColor:dark?'#43534B':'#D2CCC0',color:dark?'#EEF1E8':'#18201F',fontFamily:'DMSans',fontSize:15}}/></View>;
}

function CaptureProfileCard({dark,controller,snapshot,state,profile,setConsent}:{dark:boolean;controller:ToolsController;snapshot:CaptureSnapshot;state:CaptureState;profile:CaptureSnapshot['profiles'][number];setConsent(value:boolean):void}){
 const disabled=blocked(controller)||!ready(state.phase);
 return <Card dark={dark} key={profile.sourceProfileId}><Copy dark={dark}>{profile.displayName} · {profile.instrumentLabel} · Account {profile.accountId}</Copy>{profile.currencies.map(currency=><Action dark={dark} key={currency} label={`Capture ${profile.displayName}, ${currency}`} radio selected={snapshot.selectedSourceProfileId===profile.sourceProfileId&&snapshot.selectedCurrency===currency} disabled={disabled} onPress={()=>{setConsent(false);void controller.selectSource(profile.sourceProfileId,currency);}}/>)}</Card>;
}

function CaptureProfiles({dark,controller,snapshot,state,setConsent}:{dark:boolean;controller:ToolsController;snapshot:CaptureSnapshot;state:CaptureState;setConsent(value:boolean):void}){
 if(!snapshot.profiles.length)return <Copy dark={dark}>Import-only: source setup unavailable. No approved device source mapping is available for secure capture.</Copy>;
 return <>{snapshot.profiles.map(profile=><CaptureProfileCard dark={dark} controller={controller} snapshot={snapshot} state={state} profile={profile} setConsent={setConsent} key={profile.sourceProfileId}/>)}</>;
}

function CaptureSetupActions({dark,controller,snapshot,state,consent,setConsent,operationId}:{dark:boolean;controller:ToolsController;snapshot:CaptureSnapshot;state:CaptureState;consent:boolean;setConsent(value:boolean):void;operationId():string}){
 const isBlocked=blocked(controller),notReady=!ready(state.phase),hasSource=Boolean(snapshot.selectedSourceProfileId);
 return <>
  <Copy dark={dark} heading>Notification access</Copy>
  <Copy dark={dark}>Listener access: {snapshot.notificationAccess} · App notifications: {snapshot.appNotificationPermission}</Copy>
  <Action dark={dark} label="Open notification access settings" onPress={()=>{void controller.notificationSettings();}}/>
  <Action dark={dark} label="Open Border Ledger notification settings" onPress={()=>{void controller.notificationSettings(true);}}/>
  <Copy dark={dark} heading>Verify the source</Copy>
  <Copy dark={dark}>Source test: {snapshot.sourceTest}. Only matching listener evidence can pass this test.</Copy>
  <Action dark={dark} label="Test selected source" disabled={!hasSource||isBlocked||notReady} onPress={()=>{setConsent(false);void controller.requestTest();}}/>
  <Copy dark={dark} heading>Capture authorization</Copy>
  <Check dark={dark} label="Consent to this capture scope" checked={consent} disabled={isBlocked} onPress={()=>setConsent(!consent)}/>
  <Copy dark={dark}>Source {snapshot.selectedSourceProfileId??'not selected'} · Currency {snapshot.selectedCurrency??'not selected'}. Capture authorization is separate from owner sign-in. Credentials stay in Android secure storage.</Copy>
  <Action dark={dark} label="Authorize capture" disabled={isBlocked||notReady||!canAuthorize(snapshot,consent)} onPress={()=>{void controller.authorize(operationId(),consent);setConsent(false);}}/>
  <Copy dark={dark}>Capture expires: {snapshot.credentialExpiresAt??'not authorized'}</Copy>
 </>;
}

function CaptureHealthCard({dark,health}:{dark:boolean;health:RuntimeHealth|null}){
 if(!health)return null;
 return <Card dark={dark}><Copy dark={dark} heading>Background capture health</Copy><Copy dark={dark}>Listener {health.listenerConnected?'connected':'disconnected'} · Permission {health.listenerPermission}</Copy><Copy dark={dark}>First unlock {health.firstUnlock} · Storage {health.storage} · Source {health.source}</Copy><Copy dark={dark}>Intake {health.intake} · Upload {health.upload} · Pending {health.pendingCount}/{health.pendingLimit} · Stored intake {health.storedIntakeCount}</Copy><Copy dark={dark}>Retry {health.uploadRetryAttempt}/{health.uploadRetryMaxAttempts} · Next {health.uploadRetryAt??'none'}</Copy><Copy dark={dark}>Last upload {health.lastSuccessfulUploadAt??'none'} · Last cache {health.lastCacheSnapshotAt??'none'} · Renewal {health.pairingRenewalRequired?'required':'not required'}</Copy></Card>;
}

function CaptureDetails({dark,controller,snapshot,state,consent,setConsent,operationId}:CaptureDetailsProps){
 return <>
  <Copy dark={dark} heading>Secure notification capture</Copy>
  <Copy dark={dark}>Choose an approved source, grant notification access, then test a real bank notification. Authorize only the scope you review below.</Copy>
  <Copy dark={dark}>Capture: {snapshot.health} · API: {snapshot.apiHealth} · Source setup: {snapshot.sourceSetupStatus}</Copy>
  <Copy dark={dark} heading>Approved source</Copy>
  <CaptureProfiles dark={dark} controller={controller} snapshot={snapshot} state={state} setConsent={setConsent}/>
  <CaptureSetupActions dark={dark} controller={controller} snapshot={snapshot} state={state} consent={consent} setConsent={setConsent} operationId={operationId}/>
 </>;
}

export function CaptureView({dark,controller,operationId}:Props){
 const [consent,setConsent]=useState(false),state=controller.capture.current(),snapshot=state.data,health=controller.health.current().data;
 useEffect(()=>setConsent(false),[snapshot?.selectedSourceProfileId,snapshot?.selectedCurrency,snapshot?.sourceTest,snapshot?.sourceConfigRevision]);
 return <View style={stack}><Status dark={dark} state={state} label="capture" onRetry={()=>{setConsent(false);void controller.loadCapture(true);}}/>{snapshot?<CaptureDetails dark={dark} controller={controller} snapshot={snapshot} state={state} consent={consent} setConsent={setConsent} operationId={operationId}/>:null}<CaptureHealthCard dark={dark} health={health}/><Status dark={dark} state={controller.health.current()} label="capture health" onRetry={()=>{void controller.loadHealth();}}/></View>;
}

function DeviceMappings({dark,device}:{dark:boolean;device:Device}){
 return <>{device.sourceMappings.map((mapping,index)=><View key={`${mapping.sourceProfileId}-${index}`}><Copy dark={dark}>Source profile: {mapping.sourceProfileId} · Account: {mapping.accountId}</Copy><Copy dark={dark}>Currencies: {mapping.allowedCurrencies.join(', ')} · Instrument: {mapping.instrumentHint?`${mapping.instrumentHint.kind}: ${mapping.instrumentHint.value}`:'not specified'}</Copy></View>)}</>;
}

function DeviceCard({dark,controller,device,interactive,onCapture,onRevoke}:{dark:boolean;controller:ToolsController;device:Device;interactive:boolean;onCapture?():void;onRevoke(id:string):void}){
 const canOpen=device.status==='paired'&&!device.revokedAt&&device.sourceMappings.length>0;
 return <ToolSection dark={dark} title={device.name}><ToolLabel dark={dark}>{device.platform} · {device.status} · Revision {device.revision}</ToolLabel><Copy dark={dark}>Capture expires {device.credentialExpiresAt??'not authorized'} · Revoked {device.revokedAt??'no'}</Copy><Copy dark={dark} heading>Source scope (read-only)</Copy><ToolLabel dark={dark}>{device.sourceMappings.length?'Source mappings are shown from the owner device snapshot. Editing is unavailable in this screen.':'Import-only: source setup unavailable.'}</ToolLabel><DeviceMappings dark={dark} device={device}/>{canOpen?<Action dark={dark} label={`Open secure capture setup for ${device.name}`} onPress={()=>onCapture?.()}/>:null}{!device.revokedAt?<Action dark={dark} label={`Revoke ${device.name}`} disabled={blocked(controller)||!interactive} onPress={()=>onRevoke(device.id)}/>:null}</ToolSection>;
}

export function DevicesView({dark,controller,operationId,onCapture}:Props){
 const state=controller.devices.current(),[revoke,setRevoke]=useState<string|null>(null),device=state.data?.find(value=>value.id===revoke),close=()=>setRevoke(null);
 return <View style={stack}><Status dark={dark} state={state} label="devices" onRetry={()=>{void controller.loadDevices();}}/>{state.data?.length===0?<Copy dark={dark}>No paired devices are available.</Copy>:null}{state.data?.map(value=><DeviceCard dark={dark} controller={controller} device={value} interactive={ready(state.phase)} onCapture={onCapture} onRevoke={setRevoke} key={value.id}/>)}{device&&state.phase!=='locked'?<DetailModal dark={dark} title="Confirm device revocation" onClose={close}><Copy dark={dark}>Revoke capture access for {device.name}? Existing ledger records remain available.</Copy><Action dark={dark} label={`Confirm revoke ${device.name}`} disabled={blocked(controller)} onPress={()=>{void controller.revoke(operationId(),device.id,true);close();}}/><Action dark={dark} label="Keep device" onPress={close}/></DetailModal>:null}</View>;
}

function WeekStartChoices({dark,weekStart,onChange}:{dark:boolean;weekStart:number;onChange(day:number):void}){
 return <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{[{day:0,label:'Sunday'},{day:1,label:'Monday'}].map(choice=><Action dark={dark} key={choice.day} label={`Week starts: ${choice.label}`} text={choice.label} radio selected={weekStart===choice.day} onPress={()=>onChange(choice.day)}/>)}</View>;
}

function CurrencyChooser({dark,draft,setDraft,search,setSearch,onClose}:{dark:boolean;draft:ReportingUpdate;setDraft(value:ReportingUpdate):void;search:string;setSearch(value:string):void;onClose():void}){
 const query=search.trim().toUpperCase(),currencies=[null,...reportingCurrencies.filter(currency=>currency.includes(query))];
 return <DetailModal dark={dark} title="Total spending currency" onClose={onClose}><Field dark={dark} label="Search ISO currency" value={search} onChange={setSearch}/>{currencies.map(currency=><Action dark={dark} key={currency??'source'} label={`Reporting currency: ${currency??'Source currencies'}`} radio selected={draft.preferredCurrency===currency} onPress={()=>{setDraft({...draft,preferredCurrency:currency});onClose();}}/>)}<Action dark={dark} label="Close currency choices" onPress={onClose}/></DetailModal>;
}

function DevicePreferenceChoices({dark,controller,display}:{dark:boolean;controller:ToolsController;display:ReturnType<ToolsController['display']['current']>}){
 const value=display.data;if(!value)return null;
 return <><ToolLabel dark={dark}>Appearance</ToolLabel><View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{['System','Light','Dark'].map(appearanceMode=><Action dark={dark} key={appearanceMode} label={`Appearance: ${appearanceMode}`} text={appearanceMode} radio selected={value.appearanceMode===appearanceMode} disabled={!ready(display.phase)} onPress={()=>{void controller.updateDisplay({...value,appearanceMode});}}/>)}</View><ToolLabel dark={dark}>Default filter</ToolLabel><View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{['All','NeedsReview','Provisional'].map(filter=><Action dark={dark} key={filter} label={`Device filter: ${filter}`} text={filter==='NeedsReview'?'Needs review':filter} radio selected={value.filter===filter} disabled={!ready(display.phase)} onPress={()=>{void controller.updateDisplay({...value,filter});}}/>)}</View><Check dark={dark} label="Reduce motion" checked={value.reducedMotion} disabled={!ready(display.phase)} onPress={()=>{void controller.updateDisplay({...value,reducedMotion:!value.reducedMotion});}}/><Copy dark={dark}>Theme, filter and motion are stored only on this device.</Copy></>;
}

export function SettingsView({dark,controller,operationId}:Props){
 const state=controller.reporting.current(),reporting=state.data,display=controller.display.current();
 const [draft,setDraft]=useState<ReportingUpdate>({reportingTimezone:'',weekStart:1,preferredCurrency:null}),[chooseCurrency,setChooseCurrency]=useState(false),[search,setSearch]=useState('');
 useEffect(()=>{if(reporting)setDraft({reportingTimezone:reporting.reportingTimezone,weekStart:reporting.weekStart,preferredCurrency:reporting.preferredCurrency});},[reporting?.revision]);
 const openCurrency=()=>{setSearch('');setChooseCurrency(true);};
 return <View style={stack}><ToolSection dark={dark} title="Shared reporting"><Status dark={dark} state={state} label="reporting preferences" onRetry={()=>{void controller.loadReporting(true);}}/>{reporting?<><ToolLabel dark={dark}>Revision {reporting.revision}. This changes report grouping only; original event times remain intact.</ToolLabel><Field dark={dark} label="Reporting timezone" value={draft.reportingTimezone} onChange={reportingTimezone=>setDraft({...draft,reportingTimezone})}/><ToolLabel dark={dark}>Week starts on</ToolLabel><WeekStartChoices dark={dark} weekStart={draft.weekStart} onChange={weekStart=>setDraft({...draft,weekStart})}/><ToolLabel dark={dark}>Total spending currency</ToolLabel><Action dark={dark} label="Choose reporting currency" text={draft.preferredCurrency??'Source currencies (no conversion)'} onPress={openCurrency}/><Action dark={dark} label="Save reporting preferences" disabled={blocked(controller)||!ready(state.phase)||!draft.reportingTimezone.trim()} onPress={()=>{void controller.saveReporting(operationId(),draft);}}/></>:null}</ToolSection><ToolSection dark={dark} title="This device"><Status dark={dark} state={display} label="device preferences" onRetry={()=>{void controller.loadDisplay();}}/><DevicePreferenceChoices dark={dark} controller={controller} display={display}/></ToolSection>{chooseCurrency&&reporting?<CurrencyChooser dark={dark} draft={draft} setDraft={setDraft} search={search} setSearch={setSearch} onClose={()=>setChooseCurrency(false)}/>:null}</View>;
}

function AccountPicker({dark,accounts,account,setAccount}:{dark:boolean;accounts:AccountState;account:string;setAccount(value:string):void}){
 return <>{accounts.data?.map(value=><Action dark={dark} key={value.id} label={`Import account: ${value.displayName}, ${value.currencies.join(', ')}`} radio selected={account===value.id} onPress={()=>setAccount(value.id)}/>)}</>;
}

function FileAccounts({dark,controller,accounts,account,setAccount}:{dark:boolean;controller:ToolsController;accounts:AccountState;account:string;setAccount(value:string):void}){
 return <><Status dark={dark} state={accounts} label="import accounts" onRetry={()=>{void controller.loadAccounts(true);}}/><AccountPicker dark={dark} accounts={accounts} account={account} setAccount={setAccount}/>{accounts.data?.length===0?<Copy dark={dark}>No owner ledger accounts are available. Refresh the owner snapshot before choosing a statement.</Copy>:null}</>;
}

function ChooseStatement({dark,controller,accounts,account,snapshot,canUse,operationId}:{dark:boolean;controller:ToolsController;accounts:AccountState;account:string;snapshot:FileSnapshot|null;canUse:boolean;operationId():string}){
 const disabled=!canUse||!accounts.data?.some(value=>value.id===account)||Boolean(snapshot?.previewId);
 return <Action dark={dark} label="Choose CSV statement" disabled={disabled} onPress={()=>{void controller.pickImport(operationId(),account);}}/>;
}

function ImportRows({dark,controller,rows,draftReady}:{dark:boolean;controller:ToolsController;rows:RowsState;draftReady:boolean}){
 const data=rows.data;if(!data)return null;
 return <>{data.items.map(row=>{const disabled=!draftReady||!ready(rows.phase),p=toolColors(dark);return <Pressable key={row.rowId} accessibilityRole="checkbox" accessibilityLabel={`Select import row ${row.rowIndex} · ${row.merchant} · ${formatMoney(row.amountMinor,row.currency)} · ${row.currency} · ${row.date} · ${row.category} · ${row.kind} · ${row.status} · Account ${row.accountId}`} accessibilityState={{checked:row.selected,disabled}} disabled={disabled} onPress={()=>{void controller.selectRow(row.rowId,!row.selected);}} style={{minHeight:64,paddingVertical:14,borderBottomWidth:1,borderColor:p.border,gap:4,opacity:disabled?0.6:1}}><View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'baseline',gap:12}}><Text style={{fontFamily:'DMSans',fontSize:16,lineHeight:24,fontWeight:'600',color:p.text,flexShrink:1}}>{row.merchant}</Text><Text style={{fontFamily:'DMSans',fontSize:16,lineHeight:24,fontWeight:'600',fontVariant:['tabular-nums'],color:p.text,flexShrink:1,textAlign:'right'}}>{formatMoney(row.amountMinor,row.currency)}</Text></View><ToolLabel dark={dark}>{row.date} · {row.currency} · {row.category} · {row.kind} · {row.status} · Account {row.accountId}</ToolLabel><Text style={{fontFamily:'DMSans',fontSize:13,lineHeight:20,color:p.accent}}>{row.selected?'Selected':'Not selected'}</Text></Pressable>;})}{data.items.length<data.total?<Action dark={dark} label="Load more import rows" disabled={rows.phase==='loading'} onPress={()=>{void controller.loadRows(true);}}/>:null}</>;
}

function DuplicateCards({dark,controller,snapshot,draftReady,operationId}:{dark:boolean;controller:ToolsController;snapshot:FileSnapshot;draftReady:boolean;operationId():string}){
 return <>{snapshot.duplicates.map(duplicate=><Card dark={dark} key={duplicate.id}><Copy dark={dark} heading>Duplicate comparison</Copy><Copy dark={dark}>Uploaded {duplicate.statementTransactionId} ↔ Existing {duplicate.candidateTransactionId}</Copy><Copy dark={dark}>Score {duplicate.score}/100 · {duplicate.status} · {duplicate.reasonCodes.join(', ')}</Copy>{['resolve','keep_separate'].map(decision=><Action dark={dark} key={decision} label={`${decision==='resolve'?'Resolve':'Keep separate'} duplicate ${duplicate.id}`} disabled={!draftReady||duplicate.status!=='open'} onPress={()=>{void controller.duplicate(operationId(),duplicate.id,decision);}}/>)}</Card>)}</>;
}

function ImportPreview({dark,controller,snapshot,rows,ready:canUse,draftReady,operationId,onReview}:PreviewProps){
 if(!snapshot.previewId)return null;
 const tooMany=snapshot.selectedRowCount>500;
 return <><Copy dark={dark} heading>Import preview</Copy><Copy dark={dark}>{snapshot.rowCount} rows · {snapshot.selectedRowCount} selected · Revision {snapshot.revision} · Expires {snapshot.expiresAt}</Copy>{tooMany?<Copy dark={dark} error>Select no more than 500 rows before committing. Deselect rows in the preview to continue.</Copy>:null}<Copy dark={dark}>Nothing has been committed yet. Resolve each open duplicate before committing.</Copy><Status dark={dark} state={rows} label="import rows" onRetry={()=>{void controller.loadRows();}}/><ImportRows dark={dark} controller={controller} rows={rows} draftReady={draftReady}/><DuplicateCards dark={dark} controller={controller} snapshot={snapshot} draftReady={draftReady} operationId={operationId}/><Action dark={dark} label={`Review commit of ${snapshot.selectedRowCount} selected rows`} text={`Review ${snapshot.selectedRowCount} selected ${snapshot.selectedRowCount===1?'row':'rows'}`} disabled={!canUse||!canCommit(snapshot)} onPress={onReview}/><Action dark={dark} label="Cancel staged import" disabled={!canUse||!['ready','error'].includes(snapshot.importState)} onPress={()=>{void controller.cancelImport(operationId());}}/></>;
}

function FileReceipts({dark,snapshot}:{dark:boolean;snapshot:FileSnapshot}){
 return <>{snapshot.importReceiptId?<Copy dark={dark}>Last confirmed import receipt {snapshot.importReceiptId}.</Copy>:null}{snapshot.exportReceiptId?<Copy dark={dark}>Last confirmed export receipt {snapshot.exportReceiptId}. Sharing delivery is not confirmed by this file receipt.</Copy>:null}</>;
}

function ExportSection({dark,controller,operationId,canUse}:{dark:boolean;controller:ToolsController;operationId():string;canUse:boolean}){
 return <ToolSection dark={dark} title="Export ledger"><Copy dark={dark}>Export all canonical ledger rows. Android streams the CSV to your chosen document destination. Canceling the picker creates no success receipt.</Copy><Action dark={dark} label="Save ledger CSV" disabled={!canUse} onPress={()=>{void controller.exportFile(operationId(),false);}}/><Action dark={dark} label="Save and share ledger CSV" disabled={!canUse} onPress={()=>{void controller.exportFile(operationId(),true);}}/></ToolSection>;
}

function FileSnapshotContent({dark,controller,snapshot,rows,canUse,draftReady,operationId,onReview}:{dark:boolean;controller:ToolsController;snapshot:FileSnapshot;rows:RowsState;canUse:boolean;draftReady:boolean;operationId():string;onReview():void}){
 return <><Copy dark={dark}>Import: {snapshot.importState} · Export: {snapshot.exportState}</Copy>{snapshot.errors.map((error,index)=><Copy dark={dark} error key={`${error}-${index}`}>{error}</Copy>)}<ImportPreview dark={dark} controller={controller} snapshot={snapshot} rows={rows} ready={canUse} draftReady={draftReady} operationId={operationId} onReview={onReview}/><FileReceipts dark={dark} snapshot={snapshot}/><ExportSection dark={dark} controller={controller} operationId={operationId} canUse={canUse}/></>;
}

function FileBody({dark,controller,snapshot,rows,canUse,draftReady,operationId,onReview}:{dark:boolean;controller:ToolsController;snapshot:FileSnapshot|null;rows:RowsState;canUse:boolean;draftReady:boolean;operationId():string;onReview():void}){
 if(!snapshot)return null;
 return <FileSnapshotContent dark={dark} controller={controller} snapshot={snapshot} rows={rows} canUse={canUse} draftReady={draftReady} operationId={operationId} onReview={onReview}/>;
}

function CommitModal({dark,controller,snapshot,canUse,confirm,setConfirm,operationId}:{dark:boolean;controller:ToolsController;snapshot:FileSnapshot|null;canUse:boolean;confirm:boolean;setConfirm(value:boolean):void;operationId():string}){
 if(!confirm||!snapshot)return null;
 return <DetailModal dark={dark} title="Confirm selected import rows" onClose={()=>setConfirm(false)}><Copy dark={dark}>Import {snapshot.selectedRowCount} reviewed {snapshot.selectedRowCount===1?'row':'rows'}? Wait for confirmation before treating the import as complete.</Copy><ToolLabel dark={dark}>Preview {snapshot.previewId} · Revision {snapshot.revision}</ToolLabel><Action dark={dark} label="Confirm import commit" disabled={!canUse||!canCommit(snapshot)} onPress={()=>{setConfirm(false);void controller.commitImport(operationId());}}/><Action dark={dark} label="Back to import review" onPress={()=>setConfirm(false)}/></DetailModal>;
}

export function FilesView({dark,controller,operationId}:Props){
 const state=controller.files.current(),snapshot=state.data,rows=controller.rows.current(),accounts=controller.accounts.current(),[account,setAccount]=useState(''),[confirm,setConfirm]=useState(false),canUse=ready(state.phase)&&!blocked(controller),draftReady=canUse&&snapshot?.importState==='ready';
 useEffect(()=>setConfirm(false),[snapshot?.previewId,snapshot?.revision,snapshot?.selectedRowCount]);
 const review=()=>setConfirm(true);
 return <View style={stack}><Copy dark={dark} heading>Import statement</Copy><Copy dark={dark}>Only UTF-8 CSV statements up to 10 MiB are accepted. Android reads the document and prepares a private preview. Review before anything enters the ledger.</Copy><FileAccounts dark={dark} controller={controller} accounts={accounts} account={account} setAccount={setAccount}/><ChooseStatement dark={dark} controller={controller} accounts={accounts} account={account} snapshot={snapshot} canUse={canUse} operationId={operationId}/><Status dark={dark} state={state} label="documents" onRetry={()=>{void controller.loadFiles(true);}}/><FileBody dark={dark} controller={controller} snapshot={snapshot} rows={rows} canUse={canUse} draftReady={draftReady} operationId={operationId} onReview={review}/><CommitModal dark={dark} controller={controller} snapshot={snapshot} canUse={canUse} confirm={confirm} setConfirm={setConfirm} operationId={operationId}/></View>;
}

const mutationMessages:Record<string,string>={completed:'Native operation completed. Check the import or export receipt before treating ledger documents as confirmed.',failed_local:'The document was rejected before any backend request. Review the error or choose another document.',canceled:'Native operation canceled. No completion receipt was inferred.',revision_conflict:'This preference or preview changed elsewhere. Refresh before reviewing a new action.',rejected:'The server rejected this request. Refresh the data and review before trying again.',checking:'Checking native operation receipts…',saving:'Waiting for the native operation…',ready:'',reconciliation_required:'The submitted operation needs reconciliation.'};
const mutationMessage=(status:string)=>mutationMessages[status]??mutationMessages.reconciliation_required;

export function ToolsMutationStatus({dark,controller}:Pick<Props,'dark'|'controller'>){
 const mutation=controller.mutation.current(),message=mutationMessage(mutation.status),error=mutation.status==='rejected'||mutation.status==='reconciliation_required';
 return <View style={stack}><View accessibilityLiveRegion="polite"><Copy dark={dark} error={error}>{message}</Copy></View>{mutation.blocked?<><Copy dark={dark}>A submitted operation may still be unresolved. Refresh its native status before starting another write. A new snapshot alone cannot prove success. Drafts lost after process restart cannot be reconstructed safely.</Copy><Action dark={dark} label="Refresh submitted operation status" disabled={mutation.status==='saving'} onPress={()=>{void controller.recover();}}/></>:null}</View>;
}
