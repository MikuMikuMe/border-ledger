import type {CaptureSnapshot,RuntimeHealth,Device,FileSnapshot,RowPage,Display,Reporting,ReportingUpdate} from './contracts';
import type {ImportAccount} from './contracts';
import type {Operation} from '../finance/contracts';
import type {ToolsPorts} from './contracts';
import {Resource,MutationGate,errorState} from '../finance/model';

export const canAuthorize=(v:CaptureSnapshot,consent:boolean)=>consent&&v.notificationAccess==='Granted'&&v.sourceTest==='Passed'&&v.profiles.some(p=>p.sourceProfileId===v.selectedSourceProfileId&&p.currencies.includes(v.selectedCurrency??''))&&!['Offline','Unavailable','OwnerSessionRequired'].includes(v.apiHealth);
export const canCommit=(v:FileSnapshot)=>v.importState==='ready'&&!!v.previewId&&v.selectedRowCount>0&&v.selectedRowCount<=500&&!v.duplicates.some(d=>d.status==='open');

export class ToolsController {
 readonly capture:Resource<CaptureSnapshot>;readonly health:Resource<RuntimeHealth>;readonly devices:Resource<Device[]>;readonly files:Resource<FileSnapshot>;readonly rows:Resource<RowPage>;readonly display:Resource<Display>;readonly reporting:Resource<Reporting>;readonly accounts:Resource<ImportAccount[]>;readonly mutation:MutationGate;
 private subscriptions:{remove():void}[]=[];private locked=false;private disposed=false;
 constructor(private ports:ToolsPorts,changed:()=>void=()=>{}){
  this.capture=new Resource(changed);this.health=new Resource(changed);this.devices=new Resource(changed);this.files=new Resource(changed);this.rows=new Resource(changed);this.display=new Resource(changed);this.reporting=new Resource(changed);this.accounts=new Resource(changed);this.mutation=new MutationGate(changed);
 }
 private resources(){return [this.capture,this.health,this.devices,this.files,this.rows,this.display,this.reporting,this.accounts];}
 private available(){return !this.locked&&!this.disposed;}
 private async read<T>(call:()=>Promise<T>):Promise<T>{if(!this.available())throw {code:'unauthorized'};try{const v=await call();if(!this.available())throw {code:'unauthorized'};return v;}catch(e){if(errorState(e).phase==='locked'){this.locked=true;this.resources().forEach(r=>r.lock());}throw e;}}
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
 async loadReporting(recoverConflict=false){if(!this.available())return;await this.reporting.load(()=>this.read(()=>this.ports.preferences.readReporting()));if(recoverConflict&&this.reporting.current().phase==='ready'&&this.mutation.current().status==='revision_conflict')await this.recover();}
 async loadAccounts(refresh=false){if(!this.available())return;await this.accounts.load(async()=>{const cached=refresh?null:await this.read(()=>this.ports.ledger.getSnapshot());const snapshot=cached??await this.read(()=>this.ports.ledger.refreshSnapshot());return snapshot?.accounts??[];});}
 async loadFiles(recoverConflict=false){if(!this.available())return;const previous=this.files.current().data?.previewId;await this.files.load(()=>this.read(()=>this.ports.files.getSnapshot()));if(this.files.current().phase==='ready'){if(previous!==this.files.current().data?.previewId)this.rows.reset();await this.loadRows();if(recoverConflict&&this.rows.current().phase==='ready'&&this.mutation.current().status==='revision_conflict')await this.recover();}}
 async loadRows(more=false){if(!this.available())return;const preview=this.files.current().data?.previewId,old=more?this.rows.current().data:null;if(more&&(!old||old.items.length>=old.total||this.rows.current().phase==='loading'))return;await this.rows.load(async()=>{const next=await this.read(()=>this.ports.files.readImportRows(old?.items.length??0,50));if(preview!==this.files.current().data?.previewId)throw Error('Preview changed');return {...next,items:old?[...old.items,...next.items]:next.items};},more);}
 private async write(op:string,call:()=>Promise<Operation>,refresh:()=>Promise<void>){if(!this.available()||this.mutation.current().status==='revision_conflict')return;await this.mutation.submit(op,()=>this.read(call),id=>this.read(()=>this.ports.session.queryOperation(id)));if(this.available())await refresh();}
 async selectSource(id:string,currency:string){if(!this.available()||this.capture.current().phase!=='ready'||this.mutation.current().blocked)return;const profile=this.capture.current().data?.profiles.find(p=>p.sourceProfileId===id);if(!profile?.currencies.includes(currency))return;await this.capture.load(()=>this.read(()=>this.ports.capture.selectSource(id,currency)));}
 async requestTest(){if(!this.available()||this.mutation.current().blocked||!this.capture.current().data?.selectedSourceProfileId)return;await this.capture.load(()=>this.read(()=>this.ports.capture.requestSourceTest()));}
 async notificationSettings(appNotifications=false){if(this.available())await this.capture.load(async()=>{await this.read(()=>appNotifications?this.ports.capture.openAppNotificationSettings():this.ports.capture.openNotificationSettings());return this.read(()=>this.ports.capture.getSnapshot());});}
 async authorize(op:string,consent:boolean){const v=this.capture.current();if(v.phase==='ready'&&v.data&&canAuthorize(v.data,consent))await this.write(op,()=>this.ports.capture.startAuthorizeCapture(op,true),async()=>{await Promise.all([this.loadCapture(),this.loadHealth(),this.loadDevices()]);});}
 async revoke(op:string,id:string,confirmed:boolean){if(confirmed&&this.devices.current().phase==='ready'&&this.devices.current().data?.some(d=>d.id===id&&!d.revokedAt))await this.write(op,()=>this.ports.capture.startRevokeDevice(op,id),()=>this.loadDevices());}
 async pickImport(op:string,account:string){if(this.accounts.current().phase==='ready'&&this.accounts.current().data?.some(a=>a.id===account))await this.write(op,()=>this.ports.files.startPickImport(op,account),()=>this.loadFiles());}
 async selectRow(id:string,selected:boolean){if(!this.available()||this.mutation.current().blocked||this.files.current().data?.importState!=='ready')return;await this.files.load(()=>this.read(()=>this.ports.files.setRowSelected(id,selected)));await this.loadRows();}
 async duplicate(op:string,id:string,decision:string){const v=this.files.current();if(v.phase==='ready'&&v.data?.importState==='ready'&&v.data.duplicates.some(d=>d.id===id&&d.status==='open')&&['resolve','keep_separate'].includes(decision))await this.write(op,()=>this.ports.files.startDecideDuplicate(op,id,decision),()=>this.loadFiles());}
 async commitImport(op:string){const v=this.files.current();if(v.phase==='ready'&&v.data&&canCommit(v.data))await this.write(op,()=>this.ports.files.startCommitImport(op),()=>this.loadFiles());}
 async cancelImport(op:string){const v=this.files.current();if(v.phase==='ready'&&v.data?.previewId&&['ready','error'].includes(v.data.importState))await this.write(op,()=>this.ports.files.startCancelImport(op),()=>this.loadFiles());}
 async exportFile(op:string,share:boolean){if(this.files.current().phase==='ready')await this.write(op,()=>this.ports.files.startExport(op,{selection:'all',currency:null,startDate:null,endDate:null,share}),()=>this.loadFiles());}
 async updateDisplay(value:Display){if(!this.available())return;await this.display.load(()=>this.read(()=>this.ports.preferences.updateDisplay(value)));}
 async saveReporting(op:string,value:ReportingUpdate){const v=this.reporting.current();if(v.phase==='ready'&&v.data&&value.reportingTimezone.trim()&&[0,1].includes(value.weekStart))await this.write(op,()=>this.ports.preferences.startUpdateReporting(op,v.data!.revision,{...value,reportingTimezone:value.reportingTimezone.trim()}),()=>this.loadReporting());}
 dispose(){this.disposed=true;this.subscriptions.forEach(s=>s.remove());this.resources().forEach(r=>r.dispose());}
}
