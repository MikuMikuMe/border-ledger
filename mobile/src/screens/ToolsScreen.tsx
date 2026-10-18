import React,{useEffect,useMemo,useReducer,useState} from 'react';
import {AppState,View} from 'react-native';
import NativeCaptureDevices from '../native/specs/NativeCaptureDevices';
import NativeFiles from '../native/specs/NativeFiles';
import NativePreferences from '../native/specs/NativePreferences';
import NativeLedger from '../native/specs/NativeLedger';
import NativeSession from '../native/specs/NativeSession';
import {ToolsController} from '../features/tools/ToolsController';
import {CaptureView,DevicesView,SettingsView,FilesView,ToolsMutationStatus} from '../features/tools/ToolsViews';
import {Action} from '../features/finance/FinanceViews';
import type {ToolsPorts} from '../features/tools/contracts';
const ports:ToolsPorts={capture:NativeCaptureDevices,files:NativeFiles,preferences:NativePreferences,ledger:NativeLedger,session:NativeSession};
let sequence=0;
const operationId=()=>`mobile_tools_${Date.now().toString(36)}_${(++sequence).toString(36)}_${Math.random().toString(36).slice(2,14)}`;
export function ToolsScreen({dark,destination}:{dark:boolean;destination:'capture'|'settings'}){
 const [,render]=useReducer(n=>n+1,0),controller=useMemo(()=>new ToolsController(ports,render),[]),[pane,setPane]=useState<'capture'|'devices'|'settings'|'files'>(destination);
 useEffect(()=>setPane(destination),[destination]);
 useEffect(()=>{void controller.start();const resume=AppState.addEventListener('change',state=>{if(state==='active')void controller.resume();});return()=>{resume.remove();controller.dispose();};},[controller]);
 const props={dark,controller,operationId,onCapture:()=>setPane('capture')};
 return <View><View style={{marginTop:22,flexDirection:'row',flexWrap:'wrap',gap:8}}>{(['capture','devices','settings','files'] as const).map(value=><Action key={value} dark={dark} label={value==='files'?'Import and Export':value[0].toUpperCase()+value.slice(1)} radio selected={pane===value} onPress={()=>setPane(value)}/>)}</View><ToolsMutationStatus dark={dark} controller={controller}/>{pane==='capture'?<CaptureView {...props}/>:pane==='devices'?<DevicesView {...props}/>:pane==='settings'?<SettingsView {...props}/>:<FilesView {...props}/>}</View>;
}
