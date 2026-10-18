import type {AccountsData,Alert,Detail,DetailsPorts,LinkSnapshot,ReviewPage} from './contracts';
import type {Operation,Stream} from '../finance/contracts';
import {Resource,MutationGate,errorState} from '../finance/model';

export function reviewDisabledReason(alert:Alert,decision:string):string|null {
  const state=alert.state.toLowerCase();
  if(decision==='keep_separate'||decision==='ignore')return state==='needs_review'?null:`Only needs_review alerts can be resolved (current state: ${alert.state}).`;
  if(decision!=='link')return 'Classification is unavailable for alert events. Annotate a verified transaction instead.';
  if(!['needs_review','provisional'].includes(state))return `Only provisional or needs_review alerts can be linked (current state: ${alert.state}).`;
  if(!alert.linkAction?.targetId.trim()||!alert.linkAction.candidateTransactionId.trim())return alert.linkDisabledReason??'No bounded link action is available.';
  return ['confirms','refund_of'].includes(alert.linkAction.relation)?null:'This link relation is unsupported.';
}
function remember<T>(known:Map<string,T>,rows:T[],id:(v:T)=>string,revision:(v:T)=>number):T[] {
  rows.forEach(row=>{const key=id(row),old=known.get(key);if(!old||revision(old)<=revision(row))known.set(key,row);});return rows.map(row=>known.get(id(row))!);
}
function merge<T>(old:T[],rows:T[],id:(v:T)=>string):T[]{const map=new Map(old.map(v=>[id(v),v]));rows.forEach(v=>map.set(id(v),v));return [...map.values()];}
const emptyLink:LinkSnapshot={state:'idle',outcomeCode:null,pendingConnectionId:null,connectionId:null,accounts:[]};
export class DetailsController {
  readonly review:Resource<ReviewPage>;readonly detail:Resource<Detail>;readonly accounts:Resource<AccountsData>;readonly mutation:MutationGate;
  private subscriptions:{remove():void}[]=[];private disposed=false;private locked=false;private selectedId:string|null=null;
  private alerts=new Map<string,Alert>();private streams=new Map<string,Stream>();private link=emptyLink;private linkEpoch=0;private accountsRequest=0;
  constructor(private ports:DetailsPorts,private changed:()=>void=()=>{}){this.review=new Resource(changed);this.detail=new Resource(changed);this.accounts=new Resource(changed);this.mutation=new MutationGate(changed);}
  async start(){
    this.subscriptions=[this.ports.review.onChanged(()=>{void this.loadReview();}),this.ports.recurring.onChanged(()=>{if(this.selectedId)void this.loadDetail();}),this.ports.accounts.onStateChanged(value=>{if(!this.available())return;this.link=value;this.linkEpoch++;const data=this.accounts.current().data;if(data)this.accounts.seed({...data,link:value},true);this.changed();})];
    await Promise.all([this.recover(),this.loadReview(),this.loadAccounts()]);
  }
  private available(){return !this.disposed&&!this.locked;}
  private lock(){this.locked=true;this.alerts.clear();this.streams.clear();this.link=emptyLink;[this.review,this.detail,this.accounts].forEach(r=>r.lock());}
  private async read<T>(call:()=>Promise<T>):Promise<T>{if(!this.available())throw {code:'unauthorized'};try{return await call();}catch(error){if(errorState(error).phase==='locked')this.lock();throw error;}}
  async recover(){if(this.available())await this.mutation.recover((offset,limit)=>this.read(()=>this.ports.session.readOperations(offset,limit)));}
  async resume(){if(this.available())await Promise.all([this.recover(),this.loadReview(),this.loadAccounts(),this.selectedId?this.loadDetail():Promise.resolve()]);}
  async loadReview(more=false){
    if(!this.available())return;const current=this.review.current();if(more&&(current.phase==='loading'||!current.data?.nextCursor))return;
    const previous=more?current.data:null;
    await this.review.load(async()=>{const page=await this.read(()=>this.ports.review.readAlerts(previous?.nextCursor??null,50));if(!this.available())throw {code:'unauthorized'};
      const rows=remember(this.alerts,page.items,v=>v.eventId,v=>v.revision);return {...page,items:previous?merge(remember(this.alerts,previous.items,v=>v.eventId,v=>v.revision),rows,v=>v.eventId):rows};});
  }
  async openRecurring(id:string){if(!this.available())return;this.selectedId=id;this.detail.reset();await this.loadDetail();}
  closeRecurring(){this.selectedId=null;this.detail.reset();}
  async loadDetail(more=false,options:{recoverConflict?:boolean}={}){
    if(!this.available()||!this.selectedId)return;const id=this.selectedId,current=this.detail.current();if(more&&(current.phase==='loading'||!current.data?.nextCursor))return;
    const previous=more?current.data:null;
    await this.detail.load(async()=>{const value=await this.read(()=>this.ports.recurring.readDetail(id,previous?.nextCursor??null,50));if(!this.available()||this.selectedId!==id)throw {code:'unauthorized'};
      const stream=remember(this.streams,[value.stream],v=>v.id,v=>v.revision)[0];return {...value,stream,classification:stream.classification,history:previous?merge(previous.history,value.history,v=>v.providerTransactionId):value.history};});
    // Only the explicit refresh action can recover a definitive conflict after
    // a successful current-detail read. Recovery checks receipts; it never retries.
    if(options.recoverConflict&&!more&&this.selectedId===id&&this.detail.current().phase==='ready'&&this.mutation.current().status==='revision_conflict')await this.recover();
  }
  async loadAccounts(more=false){
    if(!this.available())return;const current=this.accounts.current();if(more&&(current.phase==='loading'||!current.data?.page.nextCursor))return;
    const previous=more?current.data:null,epoch=this.linkEpoch,request=++this.accountsRequest;
    await this.accounts.load(async()=>{const [page,connections,link]=await this.read(()=>Promise.all([this.ports.accounts.readAccounts(previous?.page.nextCursor??null,50),this.ports.accounts.readConnections(),this.ports.accounts.getSnapshot()]));
      if(!this.available())throw {code:'unauthorized'};if(epoch===this.linkEpoch&&request===this.accountsRequest)this.link=link;
      return {page:{...page,accounts:previous?merge(previous.page.accounts,page.accounts,a=>a.providerAccountId):page.accounts},connections,link:this.link};});
  }
  private async write(op:string,call:()=>Promise<Operation>,refresh:()=>Promise<void>){
    if(!this.available()||this.mutation.current().status==='revision_conflict')return;
    await this.mutation.submit(op,()=>this.read(call),id=>this.read(()=>this.ports.session.queryOperation(id)));
    if(this.available()&&['completed','canceled'].includes(this.mutation.current().status))await refresh();
  }
  async resolve(op:string,alert:Alert,decision:string){
    if(this.review.current().phase!=='ready'||reviewDisabledReason(alert,decision))return;
    const action=decision==='link'?alert.linkAction:null;
    await this.write(op,()=>this.ports.review.startReview(op,{eventId:alert.eventId,expectedRevision:alert.revision,decision,targetId:action?.targetId??null,candidateTransactionId:action?.candidateTransactionId??null,relation:action?.relation??null,allocatedMoney:action?.allocatedMoney??null}),()=>this.loadReview());
  }
  async annotate(op:string,alert:Alert,draft:{category:string;note:string}){
    if(this.review.current().phase!=='ready'||!alert.annotation||alert.annotationDisabledReason||!draft.category.trim())return;
    await this.write(op,()=>this.ports.review.startAnnotate(op,{...alert.annotation!,category:draft.category.trim().slice(0,80),note:draft.note.trim()?draft.note.slice(0,1000):null}),()=>this.loadReview());
  }
  async classify(op:string,classification:string){const current=this.detail.current(),stream=current.data?.stream;if(current.phase!=='ready'||!stream||!['unclassified','subscription','bill','other','excluded'].includes(classification))return;
    await this.write(op,()=>this.ports.recurring.startClassify(op,stream.id,stream.revision,classification),()=>this.loadDetail());}
  async connect(op:string,reconnect:string|null=null){
    const current=this.accounts.current();if(current.phase!=='ready'||['pending','loading','linking'].includes(this.link.state)||reconnect&&!current.data?.connections.some(c=>c.connectionId===reconnect))return;
    await this.write(op,()=>this.ports.accounts.startConnect(op,reconnect),()=>this.loadAccounts());
    // Read progress independently of the durable receipt; this never unlocks a write.
    if(this.available()&&['awaiting_result','reconciliation_required'].includes(this.mutation.current().status))await this.loadAccounts();
  }
  async selectAccounts(op:string,ids:string[]){const selected=[...new Set(ids)],pending=this.link.pendingConnectionId;if(this.accounts.current().phase!=='ready'||this.link.state!=='pending'||!pending||!selected.length||selected.some(id=>!this.link.accounts.some(a=>a.providerAccountId===id)))return;
    await this.write(op,()=>this.ports.accounts.startSelectAccounts(op,pending,selected),()=>this.loadAccounts());}
  async cancelPending(op:string){const pending=this.link.pendingConnectionId;if(this.accounts.current().phase!=='ready'||this.link.state!=='pending'||!pending)return;await this.write(op,()=>this.ports.accounts.startCancelPending(op,pending),()=>this.loadAccounts());}
  async sync(op:string){if(this.accounts.current().phase==='ready')await this.write(op,()=>this.ports.accounts.startSync(op),()=>this.loadAccounts());}
  async disconnect(op:string,id:string,confirmed:boolean){if(this.accounts.current().phase!=='ready'||!confirmed||!this.accounts.current().data?.connections.some(c=>c.connectionId===id))return;await this.write(op,()=>this.ports.accounts.startDisconnect(op,id),()=>this.loadAccounts());}
  dispose(){this.disposed=true;this.subscriptions.forEach(s=>s.remove());this.review.dispose();this.detail.dispose();this.accounts.dispose();this.alerts.clear();this.streams.clear();this.link=emptyLink;}
}
