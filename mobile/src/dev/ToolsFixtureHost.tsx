/** Debug-only synthetic service boundaries. This module imports no native service. */
import React,{useEffect,useMemo,useReducer,useState} from 'react';
import {ScrollView,StatusBar,Text} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {CaptureView,DevicesView,SettingsView,FilesView,ToolsMutationStatus} from '../features/tools/ToolsViews';
import {ToolsController} from '../features/tools/ToolsController';
import {Action} from '../features/finance/FinanceViews';
import {fixture as makeFixture,capture,files} from './toolsFixtures';
import type {CaptureSnapshot,FileSnapshot,ToolsPorts} from '../features/tools/contracts';

type Fixture={screen:'capture'|'devices'|'settings'|'files';state:string;dark:boolean};
type FixtureProps={dark:boolean;controller:ToolsController;operationId():string;onCapture?():void};
declare global {var __borderLedgerToolsFixture:{show(value:Fixture):void;hide():void}|undefined;}

const captureVariants:Record<string,Partial<CaptureSnapshot>>={
 permission:{notificationAccess:'Missing',sourceTest:'NotRun'},
 empty:{profiles:[],selectedSourceProfileId:null,selectedCurrency:null,health:'ImportOnly'},
};
const fileVariants:Record<string,Partial<FileSnapshot>>={
 empty:{importState:'idle',previewId:null,rowCount:0,selectedRowCount:0},
 error:{exportState:'error',errors:['export_failed']},
 receipt:{importState:'committed',previewId:null,rowCount:0,importReceiptId:'tools-fixture-receipt'},
};
const duplicateFixture={id:'tools-fixture-duplicate',statementTransactionId:'uploaded',candidateTransactionId:'existing',score:95,reasonCodes:['same_date','same_amount'],status:'open'};

function configureSnapshots(ports:ToolsPorts,state:string){
 ports.capture.getSnapshot=async()=>({...capture,...(captureVariants[state]??{})});
 ports.files.getSnapshot=async()=>({...files,...(fileVariants[state]??{}),duplicates:state==='duplicates'?[duplicateFixture]:[]});
}

function applyEmptyOverrides(ports:ToolsPorts){
 ports.files.readImportRows=async()=>({items:[],offset:0,total:0});
 ports.capture.readDevices=async()=>[];
}

function applyOfflineOverrides(ports:ToolsPorts){
 const offline=async():Promise<never>=>{throw {code:'offline'};};
 ports.capture.getSnapshot=offline;
 ports.capture.readDevices=offline;
 ports.files.getSnapshot=offline;
 ports.preferences.readReporting=offline;
}

function applyUnresolvedOverrides(ports:ToolsPorts){
 ports.session.readOperations=async()=>[{operationId:'tools-fixture-unresolved',kind:'import_commit',status:'reconciliation_required',updatedAt:'2026-10-17T00:00:00Z',resultId:null}];
}

const stateOverrides:Record<string,(ports:ToolsPorts)=>void>={empty:applyEmptyOverrides,offline:applyOfflineOverrides,unresolved:applyUnresolvedOverrides};

function configurePorts(state:string){
 const {ports}=makeFixture();
 configureSnapshots(ports,state);
 stateOverrides[state]?.(ports);
 return ports;
}

const fixtureScreens={capture:CaptureView,devices:DevicesView,settings:SettingsView,files:FilesView} satisfies Record<Fixture['screen'],React.ComponentType<FixtureProps>>;

function FixtureScreen({value,controller,onClose}:{value:Fixture;controller:ToolsController;onClose():void}){
 const Screen=fixtureScreens[value.screen],props={dark:value.dark,controller,operationId:()=> 'tools-fixture-action',onCapture:onClose};
 return <><ToolsMutationStatus dark={value.dark} controller={controller}/><Screen {...props}/></>;
}

function Scene({fixture:value,onClose}:{fixture:Fixture;onClose():void}){
 const [,render]=useReducer(n=>n+1,0),controller=useMemo(()=>new ToolsController(configurePorts(value.state),render),[value]);
 useEffect(()=>{void controller.start();return()=>controller.dispose();},[controller]);
 return <FixtureScreen value={value} controller={controller} onClose={onClose}/>;
}

function FixtureSurface({value,setValue}:{value:Fixture;setValue(value:Fixture|null):void}){
 const close=()=>setValue(null),background=value.dark?'#101715':'#F3EFE6',foreground=value.dark?'#EEF1E8':'#18201F';
 return <SafeAreaView style={{flex:1,backgroundColor:background}}><StatusBar barStyle={value.dark?'light-content':'dark-content'}/><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{padding:22,paddingBottom:40}}><Text accessibilityRole="header" style={{fontFamily:'Newsreader',fontSize:24,color:foreground}}>Synthetic fixture · {value.screen} · {value.state}</Text><Scene fixture={value} onClose={close}/><Action dark={value.dark} label="Exit synthetic fixture" onPress={close}/></ScrollView></SafeAreaView>;
}

export function ToolsFixtureHost({children}:{children:React.ReactNode}){
 const [value,setValue]=useState<Fixture|null>(null);
 useEffect(()=>{globalThis.__borderLedgerToolsFixture={show:setValue,hide:()=>setValue(null)};return()=>{delete globalThis.__borderLedgerToolsFixture;};},[]);
 if(!value)return children;
 return <FixtureSurface value={value} setValue={setValue}/>;
}
