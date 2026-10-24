import React,{useEffect,useMemo,useReducer} from 'react';
import {AppState,View} from 'react-native';
import NativeCaptureDevices from '../native/specs/NativeCaptureDevices';
import NativeFiles from '../native/specs/NativeFiles';
import NativePreferences from '../native/specs/NativePreferences';
import NativeLedger from '../native/specs/NativeLedger';
import NativeSession from '../native/specs/NativeSession';
import {ToolsController} from '../features/tools/ToolsController';
import {CaptureView,DevicesView,SettingsView,FilesView,ToolsMutationStatus} from '../features/tools/ToolsViews';

import type {ToolsPorts} from '../features/tools/contracts';
const ports:ToolsPorts={
 capture:{
  getSnapshot:NativeCaptureDevices.getSnapshot,
  getRuntimeHealth:NativeCaptureDevices.getRuntimeHealth,
  refresh:NativeCaptureDevices.refresh,
  readDevices:NativeCaptureDevices.readDevices,
  selectSource:(sourceProfileId,currency)=>NativeCaptureDevices.selectSource({sourceProfileId,currency}),
  requestSourceTest:NativeCaptureDevices.requestSourceTest,
  openNotificationSettings:NativeCaptureDevices.openNotificationSettings,
  openAppNotificationSettings:NativeCaptureDevices.openAppNotificationSettings,
  startAuthorizeCapture:(operationId,consent)=>NativeCaptureDevices.startAuthorizeCapture({operationId,consent}),
  startRevokeDevice:(operationId,deviceId)=>NativeCaptureDevices.startRevokeDevice({operationId,deviceId}),
  onStateChanged:NativeCaptureDevices.onStateChanged,
  onHealthChanged:NativeCaptureDevices.onHealthChanged,
 },
 files:{
  getSnapshot:NativeFiles.getSnapshot,
  readImportRows:(offset,limit)=>NativeFiles.readImportRows({offset,limit}),
  startPickImport:(operationId,accountId)=>NativeFiles.startPickImport({operationId,accountId}),
  setRowSelected:(rowId,selected)=>NativeFiles.setRowSelected({rowId,selected}),
  startDecideDuplicate:(operationId,candidateId,decision)=>NativeFiles.startDecideDuplicate({operationId,candidateId,decision}),
  startCommitImport:operationId=>NativeFiles.startCommitImport({operationId}),
  startCancelImport:operationId=>NativeFiles.startCancelImport({operationId}),
  startExport:(operationId,request)=>NativeFiles.startExport({operationId,...request}),
  onStateChanged:NativeFiles.onStateChanged,
 },
 preferences:{
  getSnapshot:NativePreferences.getSnapshot,
  updateDisplay:NativePreferences.updateDisplay,
  readReporting:NativePreferences.readReporting,
  startUpdateReporting:(operationId,expectedRevision,value)=>NativePreferences.startUpdateReporting({operationId,expectedRevision,value}),
  onChanged:NativePreferences.onChanged,
 },
 ledger:{getSnapshot:NativeLedger.getSnapshot,refreshSnapshot:NativeLedger.refreshSnapshot},
 session:{
  readOperations:(offset,limit)=>NativeSession.readOperations({offset,limit}),
  queryOperation:operationId=>NativeSession.queryOperation({operationId}),
 },
};
let sequence=0;
const operationId=()=>`mobile_tools_${Date.now().toString(36)}_${(++sequence).toString(36)}_${Math.random().toString(36).slice(2,14)}`;
export type ToolsDestination='capture'|'devices'|'settings'|'files';
export function ToolsScreen({dark,destination,onCapture}:{dark:boolean;destination:ToolsDestination;onCapture():void}){
 const [,render]=useReducer(n=>n+1,0),controller=useMemo(()=>new ToolsController(ports,render),[]);
 useEffect(()=>{void controller.start();const resume=AppState.addEventListener('change',state=>{if(state==='active')void controller.resume();});return()=>{resume.remove();controller.dispose();};},[controller]);
 const props={dark,controller,operationId,onCapture};
 const Screen={capture:CaptureView,devices:DevicesView,settings:SettingsView,files:FilesView}[destination];
 return <View><ToolsMutationStatus dark={dark} controller={controller}/><Screen {...props}/></View>;
}
