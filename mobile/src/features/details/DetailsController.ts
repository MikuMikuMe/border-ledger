import {canAuthorizeConnection,connectionIntent} from '../../../../contracts/lunchflow';
import type {LunchFlowBinding} from './contracts';
import type {AccountsData,Alert,Detail,DetailsPorts,LinkSnapshot,LunchFlowAccount,LunchFlowAccounts,LunchFlowSelection,ReviewPage} from './contracts';
import type {Operation,Stream} from '../finance/contracts';
import {Resource,MutationGate,errorState} from '../finance/model';
import type {LoadState} from '../finance/model';

export type ReviewDecision='keep_separate'|'ignore'|'link'|'classify';
export type Classification='unclassified'|'subscription'|'bill'|'other'|'excluded';
export type AnnotationDraft={category:string;note:string};
export type OperationCommand={operationId:string};
export type ResolveReviewCommand=OperationCommand&{alert:Alert;decision:ReviewDecision};
export type AnnotateReviewCommand=OperationCommand&{alert:Alert;draft:AnnotationDraft};
export type ClassifyRecurringCommand=OperationCommand&{classification:Classification};
export type ConnectAccountsCommand=OperationCommand&{reconnect:string|null};
export type SelectAccountsCommand=OperationCommand&{ids:string[]};
export type DisconnectAccountsCommand=OperationCommand&{connectionId:string;confirmed:boolean};
export type LunchFlowSelectionCommand=OperationCommand&{accounts:LunchFlowSelection[]};

type DetailsPhase=LoadState<unknown>['phase'];

export function reviewDisabledReason(alert:Alert,decision:ReviewDecision):string|null {
  const state=alert.state.toLowerCase();
  if(isResolutionDecision(decision))return state==='needs_review'?null:`Only needs_review alerts can be resolved (current state: ${alert.state}).`;
  if(decision!=='link')return 'Classification is unavailable for alert events. Annotate a verified transaction instead.';
  if(!isLinkableAlert(state))return `Only provisional or needs_review alerts can be linked (current state: ${alert.state}).`;
  return linkActionReason(alert);
}
function isResolutionDecision(decision:ReviewDecision){return decision==='keep_separate'||decision==='ignore';}
function isLinkableAlert(state:string){return state==='needs_review'||state==='provisional';}
function linkActionReason(alert:Alert):string|null {
  const action=alert.linkAction;
  if(!action?.targetId.trim()||!action.candidateTransactionId.trim())return alert.linkDisabledReason??'No bounded link action is available.';
  return action.relation==='confirms'||action.relation==='refund_of'?null:'This link relation is unsupported.';
}
function remember<T>(known:Map<string,T>,rows:T[],id:(v:T)=>string,revision:(v:T)=>number):T[] {
  rows.forEach(row=>{const key=id(row),old=known.get(key);if(!old||revision(old)<=revision(row))known.set(key,row);});return rows.map(row=>known.get(id(row))!);
}
function merge<T>(old:T[],rows:T[],id:(v:T)=>string):T[]{const map=new Map(old.map(v=>[id(v),v]));rows.forEach(v=>map.set(id(v),v));return [...map.values()];}
function shouldLoadMore<T extends {nextCursor:string|null}>(more:boolean,phase:DetailsPhase,data:T|null){return !more||phase!=='loading'&&!!data?.nextCursor;}
function isReady(phase:DetailsPhase){return phase==='ready';}
function canAnnotate(phase:DetailsPhase,alert:Alert,draft:AnnotationDraft){return isReady(phase)&&!!alert.annotation&&!alert.annotationDisabledReason&&!!draft.category.trim();}
function annotationValue(alert:Alert,draft:AnnotationDraft){return {...alert.annotation!,category:draft.category.trim().slice(0,80),note:draft.note.trim()?draft.note.slice(0,1000):null};}
function isClassification(value:string){return ['unclassified','subscription','bill','other','excluded'].includes(value);}
function canConnect(state:DetailsPhase,link:LinkSnapshot,reconnect:string|null,data:AccountsData|null){
  const busy=['pending','loading','linking','reconciliation_required'].includes(link.state);
  const validReconnect=!reconnect||!!data?.connections.some(connection=>connection.connectionId===reconnect);
  return isReady(state)&&!busy&&validReconnect;
}
function canSelectAccounts(state:DetailsPhase,link:LinkSnapshot,selected:string[]){
  return isReady(state)&&link.state==='pending'&&!!link.pendingConnectionId&&selected.length>0&&selected.every(id=>link.accounts.some(account=>account.providerAccountId===id));
}
function canCancelPending(state:DetailsPhase,link:LinkSnapshot){return isReady(state)&&link.state==='pending'&&!!link.pendingConnectionId;}
function canDisconnect(state:DetailsPhase,data:AccountsData|null,id:string,confirmed:boolean){return isReady(state)&&confirmed&&!!data?.connections.some(connection=>connection.connectionId===id);}
const lunchFlowKinds:readonly LunchFlowSelection['kind'][]=['chequing','savings','credit'];
function isLunchFlowKind(value:string):value is LunchFlowSelection['kind']{return lunchFlowKinds.includes(value as LunchFlowSelection['kind']);}
function validLunchFlowSelection(account:LunchFlowAccount|undefined,selection:LunchFlowSelection){
  if(!account)return false;
  if(!account.currencies.includes(selection.currency))return false;
  return isLunchFlowKind(selection.kind);
}
function canSelectLunchFlow(state:DetailsPhase,data:AccountsData|null,selections:LunchFlowSelection[]){
  if(!isReady(state))return false;
  const lunchFlow=data?.lunchFlow;
  if(!lunchFlow)return false;
  if(selections.length>25)return false;
  const seen=new Set<string>();
  return selections.every(selection=>{
    if(seen.has(selection.providerAccountId))return false;
    seen.add(selection.providerAccountId);
    const account=lunchFlow.accounts.find(value=>value.providerAccountId===selection.providerAccountId);
    return validLunchFlowSelection(account,selection);
  });
}
type LunchFlowPoll={targetIds:string[];baseline:LunchFlowBaseline;binding:LunchFlowBinding};
type LunchFlowBaseline=Map<string,{lastSyncedAt:string|null;lastAttemptAt:string|null;lastError:string|null}>;
const lunchFlowStatusDelays=[0,500,1000,2000,3000,3500] as const;
function lunchFlowBaseline(value:LunchFlowAccounts|undefined):LunchFlowBaseline{
  return new Map((value?.accounts??[]).map(account=>[account.providerAccountId,{lastSyncedAt:account.lastSyncedAt,lastAttemptAt:account.lastAttemptAt,lastError:account.lastError}]));
}
function lunchFlowStatusChanged(account:LunchFlowAccount|undefined,before:{lastSyncedAt:string|null;lastAttemptAt:string|null;lastError:string|null}|undefined){
  if(!account||!before)return false;
  if(account.lastAttemptAt!==before.lastAttemptAt)return true;
  return account.lastSyncedAt!==before.lastSyncedAt||account.lastError!==before.lastError;
}
function lunchFlowCompleted(value:LunchFlowAccounts,targetIds:string[],baseline:LunchFlowBaseline){
  return targetIds.length===0||targetIds.every(id=>lunchFlowStatusChanged(value.accounts.find(account=>account.providerAccountId===id),baseline.get(id)));
}
function mergeLunchFlowStatus(discovery:LunchFlowAccounts,status:LunchFlowAccounts):LunchFlowAccounts{
  const local=new Map(status.accounts.map(account=>[account.providerAccountId,account]));
  const seen=new Set<string>();
  const accounts=discovery.accounts.map(account=>{
    const current=local.get(account.providerAccountId);if(!current)return account;
    seen.add(account.providerAccountId);
    return {...current,currencies:account.currencies.length?account.currencies:current.currencies};
  });
  status.accounts.forEach(account=>{if(!seen.has(account.providerAccountId))accounts.push(account);});
  return {...discovery,configured:discovery.configured||status.configured,accounts};
}
function sameLunchFlowBinding(value:LunchFlowAccounts|undefined,binding:LunchFlowBinding){
  if(value?.connectionId!==binding.connectionId)return false;
  return value.generation===binding.expectedGeneration;
}
function waitForLunchFlowStatus(delay:number){return delay?new Promise<void>(resolve=>setTimeout(resolve,delay)):Promise.resolve();}
function cancelableOperation(available:boolean,link:LinkSnapshot){return available&&link.canCancel?link.operationId:null;}
function classificationStream(current:Resource<Detail>,classification:Classification):Stream|null {
  const state=current.current();
  if(!isReady(state.phase))return null;
  const stream=state.data?.stream;
  if(!stream||!isClassification(classification))return null;
  return stream;
}
const emptyLink:LinkSnapshot={state:'idle',outcomeCode:null,operationId:null,canCancel:false,pendingConnectionId:null,connectionId:null,accounts:[]};
const emptyLunchFlow:LunchFlowAccounts={configured:false,accounts:[],connectionId:null,generation:null};
export class DetailsController {
  readonly review:Resource<ReviewPage>;readonly detail:Resource<Detail>;readonly accounts:Resource<AccountsData>;readonly mutation:MutationGate;
  private subscriptions:{remove():void}[]=[];private disposed=false;private locked=false;private selectedId:string|null=null;private lunchFlowSettling=false;
  private alerts=new Map<string,Alert>();private streams=new Map<string,Stream>();private link=emptyLink;private linkEpoch=0;private accountsRequest=0;
  constructor(private ports:DetailsPorts,private changed:()=>void=()=>{}){this.review=new Resource(changed);this.detail=new Resource(changed);this.accounts=new Resource(changed);this.mutation=new MutationGate(changed);}
  lunchFlowMessage:string|null=null;
  private lunchFlowFailure(){if(this.available()){this.lunchFlowMessage='Lunch Flow could not complete the action. Check connection status, then choose the action again.';this.changed();}}
  get lunchFlowBusy(){return this.lunchFlowSettling;}
  private setLunchFlowBusy(value:boolean){if(this.lunchFlowSettling===value)return;this.lunchFlowSettling=value;if(!this.disposed)this.changed();}
  async start(){
    this.subscriptions=[this.ports.review.onChanged(()=>{void this.loadReview();}),this.ports.recurring.onChanged(()=>{if(this.selectedId)void this.loadDetail();}),this.ports.accounts.onStateChanged(value=>{if(!this.available())return;this.link=value;this.linkEpoch++;const data=this.accounts.current().data;if(data)this.accounts.seed({...data,link:value},true);this.changed();})];
    if(this.ports.accounts.onLunchFlowChanged)this.subscriptions.push(this.ports.accounts.onLunchFlowChanged(()=>{void this.loadAccounts();}));
    await Promise.all([this.recover(),this.loadReview(),this.loadAccounts()]);
  }
  private available(){return !this.disposed&&!this.locked;}
  private lock(){this.locked=true;this.alerts.clear();this.streams.clear();this.link=emptyLink;[this.review,this.detail,this.accounts].forEach(r=>r.lock());}
  private async read<T>(call:()=>Promise<T>):Promise<T>{if(!this.available())throw {code:'unauthorized'};try{return await call();}catch(error){if(errorState(error).phase==='locked')this.lock();throw error;}}
  async recover(){if(this.available())await this.mutation.recover((offset,limit)=>this.read(()=>this.ports.session.readOperations(offset,limit)));}
  async resume(){if(this.available())await Promise.all([this.recover(),this.loadReview(),this.loadAccounts(),this.selectedId?this.loadDetail():Promise.resolve()]);}
  async loadReview(more=false){
    if(!this.available())return;const current=this.review.current();if(!shouldLoadMore(more,current.phase,current.data))return;
    const previous=more?current.data:null;
    await this.review.load(()=>this.readReviewPage(previous));
  }
  private async readReviewPage(previous:ReviewPage|null):Promise<ReviewPage>{
    const page=await this.read(()=>this.ports.review.readAlerts(previous?.nextCursor??null,50));
    if(!this.available())throw {code:'unauthorized'};
    const rows=remember(this.alerts,page.items,v=>v.eventId,v=>v.revision);
    const oldRows=previous?remember(this.alerts,previous.items,v=>v.eventId,v=>v.revision):[];
    return {...page,items:previous?merge(oldRows,rows,v=>v.eventId):rows};
  }
  async openRecurring(id:string){if(!this.available())return;this.selectedId=id;this.detail.reset();await this.loadDetail();}
  closeRecurring(){this.selectedId=null;this.detail.reset();}
  async loadDetail(more=false,options:{recoverConflict?:boolean}={}){
    const request=this.detailRequest(more);if(!request)return;
    await this.detail.load(()=>this.readDetailPage(request.id,request.previous));
    // Only the explicit refresh action can recover a definitive conflict after
    // a successful current-detail read. Recovery checks receipts; it never retries.
    if(this.shouldRecoverConflict(request.id,more,options))await this.recover();
  }
  private detailRequest(more:boolean):{id:string;previous:Detail|null}|null{
    if(!this.available()||!this.selectedId)return null;
    const current=this.detail.current();if(!shouldLoadMore(more,current.phase,current.data))return null;
    return {id:this.selectedId,previous:more?current.data:null};
  }
  private async readDetailPage(id:string,previous:Detail|null):Promise<Detail>{
    const value=await this.read(()=>this.ports.recurring.readDetail(id,previous?.nextCursor??null,50));
    this.assertSelectedDetail(id);
    const stream=remember(this.streams,[value.stream],v=>v.id,v=>v.revision)[0];
    return {...value,stream,classification:stream.classification,history:previous?merge(previous.history,value.history,v=>v.providerTransactionId):value.history};
  }
  private assertSelectedDetail(id:string){if(!this.available()||this.selectedId!==id)throw {code:'unauthorized'};}
  private shouldRecoverConflict(id:string,more:boolean,options:{recoverConflict?:boolean}):boolean{
    if(!options.recoverConflict||more)return false;
    if(this.selectedId!==id)return false;
    if(this.detail.current().phase!=='ready')return false;
    return this.mutation.current().status==='revision_conflict';
  }
  async loadAccounts(more=false){
    if(!this.available())return;const current=this.accounts.current();if(more&&!shouldLoadMore(true,current.phase,current.data?.page??null))return;
    const previous=more?current.data:null,epoch=this.linkEpoch,request=++this.accountsRequest;
    await this.accounts.load(()=>this.readAccountsPage(previous,epoch,request));
  }
  private async readAccountsPage(previous:AccountsData|null,epoch:number,request:number):Promise<AccountsData>{
    const [page,connections,link,lunchFlowState]=await this.read(()=>Promise.all([
      this.ports.accounts.readAccounts(previous?.page.nextCursor??null,50),
      this.ports.accounts.readConnections(),
      this.ports.accounts.getSnapshot(),
      this.readLunchFlow(),
    ]));
    if(!this.available())throw {code:'unauthorized'};
    if(epoch===this.linkEpoch&&request===this.accountsRequest)this.link=link;
    const accounts=previous?merge(previous.page.accounts,page.accounts,a=>a.providerAccountId):page.accounts;
    return {page:{...page,accounts},connections,link:this.link,...lunchFlowState};
  }
  private async readLunchFlow(){
    const lunchFlowConnection=await this.read(()=>this.ports.accounts.readLunchFlowConnection?.()??Promise.resolve(undefined));
    if(!lunchFlowConnection?.connected)return {lunchFlowConnection,lunchFlow:emptyLunchFlow};
    const binding=connectionIntent(lunchFlowConnection);
    const lunchFlow=await this.read(()=>this.ports.accounts.readLunchFlowAccounts?.(binding)??Promise.resolve(emptyLunchFlow));
    return {lunchFlowConnection,lunchFlow};
  }
  private applyLunchFlowStatus(status:LunchFlowAccounts,poll:LunchFlowPoll):boolean {
    const current=this.accounts.current().data;
    if(!current||!this.available())return true;
    if(!sameLunchFlowBinding(status,poll.binding))return true;
    if(!sameLunchFlowBinding(current.lunchFlow,poll.binding))return true;
    const lunchFlow=mergeLunchFlowStatus(current.lunchFlow??emptyLunchFlow,status);
    this.accounts.seed({...current,lunchFlow},true);
    return lunchFlowCompleted(lunchFlow,poll.targetIds,poll.baseline);
  }
  private async refreshLunchFlowStatus(poll:LunchFlowPoll){
    try {
      const localRead=this.ports.accounts.readLunchFlowStatus;
      if(!localRead){await this.loadAccounts();return;}
      for(const delay of lunchFlowStatusDelays){
        if(!this.available())return;
        await waitForLunchFlowStatus(delay);
        let status:LunchFlowAccounts;
        try{status=await this.read(()=>localRead(poll.binding));}catch{return;}
        if(this.applyLunchFlowStatus(status,poll))break;
      }
    } finally {
      try{await this.ports.refreshLedger?.();}catch{/* A queued refresh remains visible in Accounts. */}
    }
  }
  private async write(command:OperationCommand,call:()=>Promise<Operation>,refresh:()=>Promise<void>){
    if(!this.available()||this.mutation.current().status==='revision_conflict')return;
    await this.mutation.submit(command.operationId,()=>this.read(call),id=>this.read(()=>this.ports.session.queryOperation(id)));
    if(this.available()&&['completed','canceled'].includes(this.mutation.current().status))await refresh();
  }
  private async writeLunchFlow(command:OperationCommand,call:()=>Promise<Operation>,poll:LunchFlowPoll){
    if(this.lunchFlowSettling)return;
    this.setLunchFlowBusy(true);
    try{this.lunchFlowMessage=null;await this.write(command,call,()=>this.refreshLunchFlowStatus(poll));if(this.mutation.current().status==='rejected'){this.lunchFlowFailure();await this.loadAccounts();}}
    finally{this.setLunchFlowBusy(false);}
  }
  async resolve(command:ResolveReviewCommand){
    const {operationId,alert,decision}=command;
    if(!isReady(this.review.current().phase)||reviewDisabledReason(alert,decision))return;
    const action=decision==='link'?alert.linkAction:null;
    await this.write(command,()=>this.ports.review.startReview(operationId,{eventId:alert.eventId,expectedRevision:alert.revision,decision,targetId:action?.targetId??null,candidateTransactionId:action?.candidateTransactionId??null,relation:action?.relation??null,allocatedMoney:action?.allocatedMoney??null}),()=>this.loadReview());
  }
  async annotate(command:AnnotateReviewCommand){
    const {alert,draft}=command;
    if(!canAnnotate(this.review.current().phase,alert,draft))return;
    await this.write(command,()=>this.ports.review.startAnnotate(command.operationId,annotationValue(alert,draft)),()=>this.loadReview());
  }
  async classify(command:ClassifyRecurringCommand){const stream=classificationStream(this.detail,command.classification);if(!stream)return;
    await this.write(command,()=>this.ports.recurring.startClassify(command.operationId,stream.id,stream.revision,command.classification),()=>this.loadDetail());}
  async connect(command:ConnectAccountsCommand){
    const current=this.accounts.current();if(!canConnect(current.phase,this.link,command.reconnect,current.data))return;
    await this.write(command,()=>this.ports.accounts.startConnect(command.operationId,command.reconnect),()=>this.loadAccounts());
    // Read progress independently of the durable receipt; this never unlocks a write.
    if(this.available()&&['awaiting_result','reconciliation_required'].includes(this.mutation.current().status))await this.loadAccounts();
  }
  async cancelConnect(){
    const operationId=cancelableOperation(this.available(),this.link);
    if(!operationId)return;
    await this.read(()=>this.ports.accounts.cancelConnect(operationId));
    if(this.available())await Promise.all([this.recover(),this.loadAccounts()]);
  }
  async selectAccounts(command:SelectAccountsCommand){const selected=[...new Set(command.ids)],pending=this.link.pendingConnectionId;if(!canSelectAccounts(this.accounts.current().phase,this.link,selected)||!pending)return;
    await this.write(command,()=>this.ports.accounts.startSelectAccounts(command.operationId,pending,selected),()=>this.loadAccounts());}
  async cancelPending(command:OperationCommand){const pending=this.link.pendingConnectionId;if(!canCancelPending(this.accounts.current().phase,this.link)||!pending)return;await this.write(command,()=>this.ports.accounts.startCancelPending(command.operationId,pending),()=>this.loadAccounts());}
  async sync(command:OperationCommand){if(isReady(this.accounts.current().phase))await this.write(command,()=>this.ports.accounts.startSync(command.operationId),()=>this.loadAccounts());}
  async disconnect(command:DisconnectAccountsCommand){const current=this.accounts.current();if(!canDisconnect(current.phase,current.data,command.connectionId,command.confirmed))return;await this.write(command,()=>this.ports.accounts.startDisconnect(command.operationId,command.connectionId),()=>this.loadAccounts());}
  async selectLunchFlow(command:LunchFlowSelectionCommand){
    const current=this.accounts.current();
    if(!this.ports.accounts.startLunchFlowAccountSelection||!canSelectLunchFlow(current.phase,current.data,command.accounts))return;
    const connection=current.data?.lunchFlowConnection;if(!connection?.connected)return;
    const binding=connectionIntent(connection);
    const baseline=lunchFlowBaseline(current.data?.lunchFlow),targetIds=command.accounts.map(account=>account.providerAccountId);
    await this.writeLunchFlow(command,()=>this.ports.accounts.startLunchFlowAccountSelection!(command.operationId,command.accounts,binding),{targetIds,baseline,binding});
  }
  async syncLunchFlow(command:OperationCommand){
    const current=this.accounts.current();
    if(!this.ports.accounts.startLunchFlowSync||!isReady(current.phase))return;
    const connection=current.data?.lunchFlowConnection;if(!connection?.connected)return;
    const binding=connectionIntent(connection);
    const targetIds=(current.data?.lunchFlow?.accounts??[]).filter(account=>account.selected).map(account=>account.providerAccountId);
    const baseline=lunchFlowBaseline(current.data?.lunchFlow);
    await this.writeLunchFlow(command,()=>this.ports.accounts.startLunchFlowSync!(command.operationId,binding),{targetIds,baseline,binding});
  }
  private async connectionAction(action:()=>Promise<boolean>){
    if(this.lunchFlowSettling||!this.available())return;
    this.setLunchFlowBusy(true);this.lunchFlowMessage=null;
    try{await this.read(action);if(this.available())await this.loadAccounts();}
    catch{this.lunchFlowFailure();}
    finally{this.setLunchFlowBusy(false);}
  }
  async authorizeLunchFlow(){
    const value=this.accounts.current().data?.lunchFlowConnection;
    if(!canAuthorizeConnection(value))return;
    await this.connectionAction(()=>this.ports.accounts.startLunchFlowAuthorization?.()??Promise.resolve(false));
  }
  async cancelLunchFlow(){await this.connectionAction(()=>this.ports.accounts.cancelLunchFlowAuthorization?.()??Promise.resolve(false));}
  async disconnectLunchFlow(command:OperationCommand&LunchFlowBinding){
    if(!this.ports.accounts.disconnectLunchFlow)return;
    const binding={connectionId:command.connectionId,expectedGeneration:command.expectedGeneration};
    this.lunchFlowMessage=null;
    await this.write(command,()=>this.ports.accounts.disconnectLunchFlow!(command.operationId,binding),()=>this.loadAccounts());
    if(this.mutation.current().status==='rejected'){this.lunchFlowFailure();await this.loadAccounts();}
  }
  dispose(){this.disposed=true;this.lunchFlowSettling=false;this.subscriptions.forEach(s=>s.remove());this.review.dispose();this.detail.dispose();this.accounts.dispose();this.alerts.clear();this.streams.clear();this.link=emptyLink;}
}
