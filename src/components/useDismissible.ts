import {useEffect,useRef} from 'react';

export function useDismissible(open:boolean|string|null,onClose:()=>void){
  const container=useRef<HTMLDivElement>(null),close=useRef(onClose),opener=useRef<HTMLElement|null>(null);
  close.current=onClose;
  const dismiss=()=>{close.current();opener.current?.focus();};
  useEffect(()=>{
    if(!open)return;
    opener.current=document.activeElement as HTMLElement|null;
    const pointer=(event:PointerEvent)=>{if(event.target instanceof Node&&!container.current?.contains(event.target))close.current();};
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape')dismiss();};
    document.addEventListener('pointerdown',pointer);window.addEventListener('keydown',key);
    return()=>{document.removeEventListener('pointerdown',pointer);window.removeEventListener('keydown',key);};
  },[open]);
  return {container,dismiss};
}