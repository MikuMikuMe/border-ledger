/** Debug-only visual comparison. Does not import native services or perform sign-in. */
import React, {useEffect, useState} from 'react';
import {AppState, StatusBar} from 'react-native';
import {LoginScreen} from '../screens/LoginScreen';
type Fixture = {reducedMotion: boolean; appearanceMode: 'System'|'Light'|'Dark'};
declare global {var __borderLedgerLoginFixture: {show(value: Fixture): void; hide(): void}|undefined;}
export function LoginFixtureHost({children}: {children: React.ReactNode}) {
  const [fixture,setFixture]=useState<Fixture|null>(null);
  const [active,setActive]=useState(AppState.currentState==='active');
  useEffect(()=>{
    globalThis.__borderLedgerLoginFixture={show:setFixture,hide:()=>setFixture(null)};
    const subscription=AppState.addEventListener('change',state=>setActive(state==='active'));
    return()=>{delete globalThis.__borderLedgerLoginFixture;subscription.remove();};
  },[]);
  if(!fixture)return children;
  return <><StatusBar barStyle="light-content"/><LoginScreen
    session={{state:'signed_out',expiresAt:null,pendingDestination:null,reason:null,pendingRevocations:0,environment:'synthetic'}}
    display={{...fixture,filter:'All'}} active={active}
    onSignIn={async()=>{}} onAppearance={async appearanceMode=>setFixture({...fixture,appearanceMode})} onAbout={()=>{}}
  /></>;
}
