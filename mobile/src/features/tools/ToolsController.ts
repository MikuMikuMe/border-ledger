import type {CaptureSnapshot,RuntimeHealth,Device,FileSnapshot,RowPage,Display,Reporting,ReportingUpdate} from './contracts';
import type {ImportAccount} from './contracts';
import type {Operation} from '../finance/contracts';
import type {ToolsPorts} from './contracts';
import {Resource,MutationGate,errorState} from '../finance/model';

/** Domain aliases keep native operation intent explicit at the controller boundary. */
export type OperationId = string;
export type AccountId = string;
export type DeviceId = string;
export type SourceProfileId = string;
export type CurrencyCode = string;
export type RowId = string;
export type DuplicateDecision = 'resolve'|'keep_separate';

type RowRequest={previewId:string|null;previous:RowPage|null;offset:number;more:boolean};

const isReady=(phase:string)=>phase==='ready';
const hasSelectedSource=(snapshot:CaptureSnapshot)=>Boolean(snapshot.selectedSourceProfileId);
const hasProfileCurrency=(snapshot:CaptureSnapshot,id:SourceProfileId,currency:CurrencyCode)=>snapshot.profiles.some(profile=>profile.sourceProfileId===id&&profile.currencies.includes(currency));
const isOpenDuplicate=(snapshot:FileSnapshot,id:string)=>snapshot.duplicates.some(duplicate=>duplicate.id===id&&duplicate.status==='open');
const isValidDuplicateDecision=(decision:string):decision is DuplicateDecision=>decision==='resolve'||decision==='keep_separate';
const canLoadMore=(previous:RowPage|null,phase:string)=>Boolean(previous&&previous.items.length<previous.total&&phase!=='loading');

export const canAuthorize=(v:CaptureSnapshot,consent:boolean)=>consent&&v.notificationAccess==='Granted'&&v.sourceTest==='Passed'&&hasProfileCurrency(v,v.selectedSourceProfileId??'',v.selectedCurrency??'')&&!['Offline','Unavailable','OwnerSessionRequired'].includes(v.apiHealth);
export const canCommit=(v:FileSnapshot)=>v.importState==='ready'&&!!v.previewId&&v.selectedRowCount>0&&v.selectedRowCount<=500&&!v.duplicates.some(d=>d.status==='open');

export class ToolsController {
 readonly capture:Resource<CaptureSnapshot>;readonly health:Resource<RuntimeHealth>;readonly devices:Resource<Device[]>;readonly files:Resource<FileSnapshot>;readonly rows:Resource<RowPage>;readonly display:Resource<Display>;readonly reporting:Resource<Reporting>;readonly accounts:Resource<ImportAccount[]>;readonly mutation:MutationGate;
 private subscriptions:{remove():void}[]=[];private locked=false;private disposed=false;
 constructor(private ports:ToolsPorts,changed:()=>void=()=>{}){
  this.capture=new Resource(changed);this.health=new Resource(changed);this.devices=new Resource(changed);this.files=new Resource(changed);this.rows=new Resource(changed);this.display=new Resource(changed);this.reporting=new Resource(changed);this.accounts=new Resource(changed);this.mutation=new MutationGate(changed);
 }
 private resources(){return [this.capture,this.health,this.devices,this.files,this.rows,this.display,this.reporting,this.accounts];}
 private available(){return !this.locked&&!this.disposed;}
 private async read<T>(call:()=>Promise<T>):Promise<T>{if(!this.available())throw {code:'unauthorized'};try{const value=await call();if(!this.available())throw {code:'unauthorized'};return value;}catch(error){if(errorState(error).phase==='locked')this.lockForUnauthorized();throw error;}}
 private lockForUnauthorized(){this.locked=true;this.resources().forEach(resource=>resource.lock());}
 async start(){
  this.subscriptions=[this.ports.capture.onStateChanged(()=>{void this.loadCapture();}),this.ports.capture.onHealthChanged(()=>{void this.loadHealth();}),this.ports.files.onStateChanged(()=>{void this.loadFiles();}),this.ports.preferences.onChanged(()=>{void this.loadDisplay();})];
  await this.resume();
 }
 async recover(){if(this.available())await this.mutation.recover((offset,limit)=>this.read(()=>this.ports.session.readOperations(offset,limit)));}
 async resume(){if(this.available())await Promise.all([this.recover(),this.loadCapture(),this.loadHealth(),this.loadDevices(),this.loadFiles(),this.loadDisplay(),this.loadReporting(),this.loadAccounts()]);}
 async loadCapture(refresh=false){if(this.available())await this.capture.load(()=>this.read(()=>refresh?this.ports.capture.refresh():this.ports.capture.getSnapshot()));}
 async loadHealth(){if(this.available())await this.health.load(()=>this.read(()=>this.ports.capture.getRuntimeHealth()));}
 async loadDevices(){if(this.available())await this.devices.load(()=>this.read(()=>this.ports.capture.readDevices()));}
 async loadDisplay(){if(this.available())await this.display.load(()=>this.read(()=>this.ports.preferences.getSnapshot()));}
 async loadReporting(recoverConflict=false){if(!this.available())return;await this.reporting.load(()=>this.read(()=>this.ports.preferences.readReporting()));if(this.shouldRecoverReporting(recoverConflict))await this.recover();}
 private shouldRecoverReporting(recoverConflict:boolean){return recoverConflict&&isReady(this.reporting.current().phase)&&this.mutation.current().status==='revision_conflict';}
 async loadAccounts(refresh=false){if(!this.available())return;await this.accounts.load(()=>this.readAccounts(refresh));}
 private async readAccounts(refresh:boolean){const cached=refresh?null:await this.read(()=>this.ports.ledger.getSnapshot());const snapshot=cached??await this.read(()=>this.ports.ledger.refreshSnapshot());return snapshot?.accounts??[];}
 async loadFiles(recoverConflict=false){if(!this.available())return;const previous=this.files.current().data?.previewId;await this.files.load(()=>this.read(()=>this.ports.files.getSnapshot()));if(!isReady(this.files.current().phase))return;this.resetRowsIfPreviewChanged(previous);await this.loadRows();if(this.shouldRecoverRows(recoverConflict))await this.recover();}
 private resetRowsIfPreviewChanged(previous:string|null|undefined){if(previous!==this.files.current().data?.previewId)this.rows.reset();}
 private shouldRecoverRows(recoverConflict:boolean){return recoverConflict&&isReady(this.rows.current().phase)&&this.mutation.current().status==='revision_conflict';}
 async loadRows(more=false){if(!this.available())return;const request=this.createRowRequest(more);if(!request)return;await this.rows.load(()=>this.readRows(request),more);}
 private createRowRequest(more:boolean):RowRequest|null{const previous=more?this.rows.current().data:null;if(more&&!canLoadMore(previous,this.rows.current().phase))return null;return {previewId:this.files.current().data?.previewId??null,previous,offset:previous?.items.length??0,more};}
 private async readRows(request:RowRequest){const next=await this.read(()=>this.ports.files.readImportRows(request.offset,50));if(request.previewId!==this.files.current().data?.previewId)throw Error('Preview changed');return {...next,items:request.previous?[...request.previous.items,...next.items]:next.items};}
 private async write(op:OperationId,call:()=>Promise<Operation>,refresh:()=>Promise<void>){if(!this.canWrite())return;await this.mutation.submit(op,()=>this.read(call),id=>this.read(()=>this.ports.session.queryOperation(id)));if(this.available())await refresh();}
 private canWrite(){return this.available()&&this.mutation.current().status!=='revision_conflict';}
 async selectSource(id:SourceProfileId,currency:CurrencyCode){if(!this.canSelectSource(id,currency))return;await this.capture.load(()=>this.read(()=>this.ports.capture.selectSource(id,currency)));}
 private canSelectSource(id:SourceProfileId,currency:CurrencyCode){const state=this.capture.current();return this.available()&&isReady(state.phase)&&!this.mutation.current().blocked&&Boolean(state.data&&hasProfileCurrency(state.data,id,currency));}
 async requestTest(){if(!this.canRequestTest())return;await this.capture.load(()=>this.read(()=>this.ports.capture.requestSourceTest()));}
 private canRequestTest(){const data=this.capture.current().data;return this.available()&&!this.mutation.current().blocked&&Boolean(data&&hasSelectedSource(data));}
 async notificationSettings(appNotifications=false){if(this.available())await this.capture.load(()=>this.openNotificationSettings(appNotifications));}
 private async openNotificationSettings(appNotifications:boolean){const open=appNotifications?this.ports.capture.openAppNotificationSettings:this.ports.capture.openNotificationSettings;await this.read(open);return this.read(()=>this.ports.capture.getSnapshot());}
 async authorize(op:OperationId,consent:boolean){const state=this.capture.current();if(!this.canAuthorizeCapture(state,consent))return;await this.write(op,()=>this.ports.capture.startAuthorizeCapture(op,true),()=>Promise.all([this.loadCapture(),this.loadHealth(),this.loadDevices()]).then(()=>undefined));}
 private canAuthorizeCapture(state:ReturnType<Resource<CaptureSnapshot>['current']>,consent:boolean){if(!isReady(state.phase))return false;return Boolean(state.data&&canAuthorize(state.data,consent));}
 async revoke(op:OperationId,id:DeviceId,confirmed:boolean){if(this.canRevoke(id,confirmed))await this.write(op,()=>this.ports.capture.startRevokeDevice(op,id),()=>this.loadDevices());}
 private canRevoke(id:DeviceId,confirmed:boolean){return confirmed&&isReady(this.devices.current().phase)&&Boolean(this.devices.current().data?.some(device=>device.id===id&&!device.revokedAt));}
 async pickImport(op:OperationId,account:AccountId){if(this.canPickImport(account))await this.write(op,()=>this.ports.files.startPickImport(op,account),()=>this.loadFiles());}
 private canPickImport(account:AccountId){return isReady(this.accounts.current().phase)&&Boolean(this.accounts.current().data?.some(value=>value.id===account));}
 async selectRow(id:RowId,selected:boolean){if(!this.canSelectRow())return;await this.files.load(()=>this.read(()=>this.ports.files.setRowSelected(id,selected)));await this.loadRows();}
 private canSelectRow(){return this.available()&&!this.mutation.current().blocked&&this.files.current().data?.importState==='ready';}
 async duplicate(op:OperationId,id:string,decision:string){const state=this.files.current();if(this.canDuplicate(state,id,decision))await this.write(op,()=>this.ports.files.startDecideDuplicate(op,id,decision),()=>this.loadFiles());}
 private canDuplicate(state:ReturnType<Resource<FileSnapshot>['current']>,id:string,decision:string):decision is DuplicateDecision{return isReady(state.phase)&&state.data?.importState==='ready'&&Boolean(state.data&&isOpenDuplicate(state.data,id))&&isValidDuplicateDecision(decision);}
 async commitImport(op:OperationId){const state=this.files.current();if(!this.canCommitImport(state))return;await this.write(op,()=>this.ports.files.startCommitImport(op),()=>this.loadFiles());}
 private canCommitImport(state:ReturnType<Resource<FileSnapshot>['current']>){if(!isReady(state.phase))return false;return Boolean(state.data&&canCommit(state.data));}
 async cancelImport(op:OperationId){const state=this.files.current();if(isReady(state.phase)&&this.canCancelImport(state.data))await this.write(op,()=>this.ports.files.startCancelImport(op),()=>this.loadFiles());}
 private canCancelImport(snapshot:FileSnapshot|null){return Boolean(snapshot?.previewId&&['ready','error'].includes(snapshot.importState));}
 async exportFile(op:OperationId,share:boolean){if(isReady(this.files.current().phase))await this.write(op,()=>this.ports.files.startExport(op,{selection:'all',currency:null,startDate:null,endDate:null,share}),()=>this.loadFiles());}
 async updateDisplay(value:Display){if(!this.available())return;await this.display.load(()=>this.read(()=>this.ports.preferences.updateDisplay(value)));}
 async saveReporting(op:OperationId,value:ReportingUpdate){const state=this.reporting.current();if(this.canSaveReporting(state.data,value))await this.write(op,()=>this.ports.preferences.startUpdateReporting(op,state.data!.revision,this.normalizedReporting(value)),()=>this.loadReporting());}
 private canSaveReporting(state:ReportingUpdate&{revision:number}|null,value:ReportingUpdate){return isReady(this.reporting.current().phase)&&Boolean(state&&value.reportingTimezone.trim()&&[0,1].includes(value.weekStart));}
 private normalizedReporting(value:ReportingUpdate){return {...value,reportingTimezone:value.reportingTimezone.trim()};}
 dispose(){this.disposed=true;this.subscriptions.forEach(s=>s.remove());this.resources().forEach(r=>r.dispose());}
}
