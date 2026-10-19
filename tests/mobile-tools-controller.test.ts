import {describe,it,expect} from 'vitest';
import {ToolsController,canAuthorize,canCommit} from '../mobile/src/features/tools/ToolsController';
import type {ToolsPorts} from '../mobile/src/features/tools/contracts';
import {MutationGate} from '../mobile/src/features/finance/model';

import {capture,files,row,fixture} from '../mobile/src/dev/toolsFixtures';
describe('capture, settings and native document flows',()=>{
 it('refuses a default-selected 501-row preview without submitting a native commit',async()=>{
  const f=fixture();f.ports.files.getSnapshot=async()=>({...files,rowCount:501,selectedRowCount:501});const c=new ToolsController(f.ports);await c.start();expect(canCommit({...files,rowCount:501,selectedRowCount:501})).toBe(false);await c.commitImport('too-many');expect(f.writes).toEqual([]);expect(c.mutation.current().blocked).toBe(false);c.dispose();
 });
 it('allows a new document after a proven local parser failure, including journal recovery, without retrying the old picker',async()=>{
  const f=fixture();let picks=0;f.ports.files.getSnapshot=async()=>({...files,importState:'error',previewId:null,rowCount:0,selectedRowCount:0,errors:['corrupt_document']});f.ports.files.startPickImport=async op=>{picks++;f.writes.push(['pick',op]);return {operationId:op,kind:'import_picker',status:picks===1?'failed_local':'awaiting_result',updatedAt:'2026-10-17T00:00:00Z',resultId:null};};
  const c=new ToolsController(f.ports);await c.start();await c.pickImport('bad-document','account');expect(c.mutation.current().blocked).toBe(false);f.ports.session.readOperations=async()=>[{operationId:'bad-document',kind:'import_picker',status:'failed_local',updatedAt:'2026-10-17T00:00:00Z',resultId:null}];await c.resume();expect(c.mutation.current().blocked).toBe(false);await c.pickImport('corrected-document','account');expect(f.writes).toEqual([['pick','bad-document'],['pick','corrected-document']]);expect(c.mutation.current().blocked).toBe(true);c.dispose();
 });
 it('imports to the owner ledger account ID rather than a provider account selection ID',async()=>{
  const f=fixture();Object.assign(f.ports,{ledger:{getSnapshot:async()=>({accounts:[{id:'ledger-account',displayName:'Manual card',currencies:['CAD']}]}),refreshSnapshot:async()=>({accounts:[{id:'ledger-account',displayName:'Manual card',currencies:['CAD']}]})}});
  const c=new ToolsController(f.ports);await c.start();await c.pickImport('pick-ledger','ledger-account');expect(f.writes).toEqual([['import_picker','pick-ledger','ledger-account']]);c.dispose();
 });
 it('requires an explicit successful document refresh to recover a definitive conflict and never retries commit',async()=>{
  const f=fixture();f.ports.files.startCommitImport=async op=>{f.writes.push(['commit',op]);return {operationId:op,kind:'import_commit',status:'revision_conflict',updatedAt:'2026-10-17T00:00:00Z',resultId:null};};const c=new ToolsController(f.ports);await c.start();await c.commitImport('old');await c.loadFiles();expect(c.mutation.current().status).toBe('revision_conflict');await c.loadFiles(true);expect(c.mutation.current().blocked).toBe(false);expect(c.mutation.current().status).toBe('ready');expect(f.writes).toEqual([['commit','old']]);c.dispose();
 });
 it('requires an offered source, listener permission, real evidence and explicit consent',()=>{
  expect(canAuthorize(capture,true)).toBe(true);expect(canAuthorize(capture,false)).toBe(false);
  for(const change of [{sourceTest:'SyntheticOnly'},{notificationAccess:'Missing'},{selectedCurrency:'USD'},{selectedSourceProfileId:null}])expect(canAuthorize({...capture,...change},true)).toBe(false);
 });
 it('blocks every unresolved native write kind after reload, across screen groups',async()=>{
  for(const kind of ['authorize_capture','revoke_device','source_config','authorize_device','import_picker','import_duplicate','import_commit','import_cancel','export_picker','reporting_preferences','capture_sync']){
   const gate=new MutationGate();await gate.recover(async()=>[{operationId:'old',kind,status:'submitted',updatedAt:'2026-10-17T00:00:00Z',resultId:null}]);expect(gate.current().blocked,kind).toBe(true);
  }
 });
 it('loads bounded review rows and refuses commit with unresolved duplicates or no selection',async()=>{
  expect(canCommit({...files,duplicates:[{id:'dup',statementTransactionId:'a',candidateTransactionId:'b',score:90,reasonCodes:[],status:'open'}]})).toBe(false);expect(canCommit({...files,selectedRowCount:0})).toBe(false);
  const f=fixture(),c=new ToolsController(f.ports);await c.start();expect(c.rows.current().data?.items[0].amountMinor).toBe('9007199254740993');await c.commitImport('commit');expect(f.writes).toEqual([['import_commit','commit']]);c.dispose();
 });
 it('never reopens a picker or retries after a lost promise; cancel remains a receipt state',async()=>{
  const f=fixture();f.ports.files.startPickImport=async(op,account)=>{f.writes.push(['pick',op,account]);throw Error('lost');};const c=new ToolsController(f.ports);await c.start();await c.pickImport('pick','account');await c.pickImport('again','account');expect(f.writes).toEqual([['pick','pick','account']]);expect(c.mutation.current().status).toBe('reconciliation_required');c.dispose();
 });
 it('refreshes native picker progress while retaining the durable gate and handles cancellation on resume',async()=>{
  const f=fixture();f.ports.files.startExport=async op=>({operationId:op,kind:'export_picker',status:'awaiting_result',updatedAt:'2026-10-17T00:00:00Z',resultId:null});const c=new ToolsController(f.ports);await c.start();await c.exportFile('save',false);expect(c.mutation.current().blocked).toBe(true);f.ports.session.readOperations=async()=>[{operationId:'save',kind:'export_picker',status:'canceled',updatedAt:'2026-10-17T00:00:00Z',resultId:null}];await c.resume();expect(c.mutation.current().blocked).toBe(false);expect(c.files.current().data?.exportReceiptId).toBeNull();c.dispose();
 });
 it('uses current reporting revision and preserves device preferences through native persistence',async()=>{
  const f=fixture();let saved={appearanceMode:'System',filter:'All',reducedMotion:false};f.ports.preferences.updateDisplay=async value=>(saved=value);f.ports.preferences.getSnapshot=async()=>saved;
  const c=new ToolsController(f.ports);await c.start();await c.updateDisplay({appearanceMode:'Dark',filter:'NeedsReview',reducedMotion:true});await c.resume();expect(c.display.current().data).toEqual(saved);await c.saveReporting('prefs',{reportingTimezone:'Europe/London',weekStart:0,preferredCurrency:'CAD'});expect(f.writes).toEqual([['reporting_preferences','prefs',7,{reportingTimezone:'Europe/London',weekStart:0,preferredCurrency:'CAD'}]]);c.dispose();
 });
 it('requires confirmation before revoke and locks all protected content on authorization rejection',async()=>{
  const f=fixture(),c=new ToolsController(f.ports);await c.start();await c.revoke('revoke','device',false);expect(f.writes).toEqual([]);f.ports.capture.startRevokeDevice=async()=>{throw {code:'unauthorized'};};let queries=0;f.ports.session.queryOperation=async()=>{queries++;return null;};await c.revoke('revoke','device',true);expect(queries).toBe(0);expect(c.files.current().phase).toBe('locked');expect(c.capture.current().data).toBeNull();expect(c.rows.current().data).toBeNull();c.dispose();
 });
});
