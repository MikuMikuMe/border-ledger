import {createContext,useEffect,useRef} from 'react';
import {AccessibilityInfo,findNodeHandle,NativeModules,Platform,type View} from 'react-native';
import type React from 'react';

export type FocusTarget=React.RefObject<React.ComponentRef<typeof View>|null>;
export function useAccessibilityReturnFocus(open:boolean){
  const target=useRef<FocusTarget|null>(null),wasOpen=useRef(false),suppressed=useRef(false);
  useEffect(()=>{
    if(open){wasOpen.current=true;return;}
    if(!wasOpen.current)return;
    wasOpen.current=false;
    if(suppressed.current){suppressed.current=false;return;}
    // Android Modal has no onDismiss callback; allow its fade to finish first.
    const timer=setTimeout(()=>{const node=findNodeHandle(target.current?.current);if(node){if(Platform.OS==='android'&&NativeModules.NativeAccessibilityFocus)NativeModules.NativeAccessibilityFocus.focus(node);else AccessibilityInfo.setAccessibilityFocus(node);}},350);
    return()=>clearTimeout(timer);
  },[open]);
  return {remember:(ref:FocusTarget)=>{target.current=ref;},suppress:()=>{suppressed.current=true;}};
}

export const ManualEntryFocusContext=createContext<(open:boolean)=>void>(()=>{});
