/** Debug-only synthetic service boundaries. This module imports no native service. */
import React,{useEffect,useMemo,useReducer,useState} from 'react';
import {ScrollView,StatusBar,Text} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {CaptureView,DevicesView,SettingsView,FilesView,ToolsMutationStatus} from '../features/tools/ToolsViews';
import {ToolsController} from '../features/tools/ToolsController';
import {Action} from '../features/finance/FinanceViews';
import {fixture,capture,files} from './toolsFixtures';
type Fixture={screen:'capture'|'devices'|'settings'|'files';state:string;dark:boolean};
declare global {var __borderLedgerToolsFixture:{show(value:Fixture):void;hide():void}|undefined;}
function Scene({fixture:value,onClose}:{fixture:Fixture;onClose():void}){
 const [,render]=useReducer(n=>n+1,0),controller=useMemo(()=>{
  const {ports}=fixture(),state=value.state;
  ports.capture.getSnapshot=async()=>({...capture,...(state==='permission'?{notificationAccess:'Missing',sourceTest:'NotRun'}:state==='empty'?{profiles:[],selectedSourceProfileId:null,selectedCurrency:null,health:'ImportOnly'}:{})});
  ports.files.getSnapshot=async()=>({...files,...(state==='empty'?{importState:'idle',previewId:null,rowCount:0,selectedRowCount:0}:state==='error'?{exportState:'error',errors:['export_failed']}:state==='receipt'?{importState:'committed',previewId:null,rowCount:0,importReceiptId:'tools-fixture-receipt'}:{}),duplicates:state==='duplicates'?[{id:'tools-fixture-duplicate',statementTransactionId:'uploaded',candidateTransactionId:'existing',score:95,reasonCodes:['same_date','same_amount'],status:'open'}]:[]});
  if(state==='empty'){ports.files.readImportRows=async()=>({items:[],offset:0,total:0});ports.capture.readDevices=async()=>[];}
  if(state==='offline'){const offline=async()=>{throw {code:'offline'};};ports.capture.getSnapshot=offline;ports.capture.readDevices=offline;ports.files.getSnapshot=offline;ports.preferences.readReporting=offline;}
  if(state==='unresolved')ports.session.readOperations=async()=>[{operationId:'tools-fixture-unresolved',kind:'import_commit',status:'reconciliation_required',updatedAt:'2026-10-17T00:00:00Z',resultId:null}];
  return new ToolsController(ports,render);
 },[value]);
 useEffect(()=>{void controller.start();return()=>controller.dispose();},[controller]);
 const props={dark:value.dark,controller,operationId:()=> 'tools-fixture-action',onCapture:onClose};
 return <><ToolsMutationStatus dark={value.dark} controller={controller}/>{value.screen==='capture'?<CaptureView {...props}/>:value.screen==='devices'?<DevicesView {...props}/>:value.screen==='settings'?<SettingsView {...props}/>:<FilesView {...props}/>}</>;
}
export function ToolsFixtureHost({children}:{children:React.ReactNode}){
 const [value,setValue]=useState<Fixture|null>(null);
 useEffect(()=>{globalThis.__borderLedgerToolsFixture={show:setValue,hide:()=>setValue(null)};return()=>{delete globalThis.__borderLedgerToolsFixture;};},[]);
 if(!value)return children;
 return <SafeAreaView style={{flex:1,backgroundColor:value.dark?'#101715':'#F3EFE6'}}><StatusBar barStyle={value.dark?'light-content':'dark-content'}/><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{padding:22,paddingBottom:40}}><Text accessibilityRole="header" style={{fontFamily:'Newsreader',fontSize:24,color:value.dark?'#EEF1E8':'#18201F'}}>Synthetic fixture · {value.screen} · {value.state}</Text><Scene fixture={value} onClose={()=>setValue(null)}/><Action dark={value.dark} label="Exit synthetic fixture" onPress={()=>setValue(null)}/></ScrollView></SafeAreaView>;
}
