import {useEffect,useRef,useState} from 'react';

/** Follow refreshed server values until the user has an unsaved edit. */
export function useBudgetDraft<T extends string>(initial:T) {
 const [value,setValue]=useState(initial),previous=useRef(initial);
 useEffect(()=>{
  const baseline=previous.current;
  setValue(current=>Object.is(current,baseline)?initial:current);
  previous.current=initial;
 },[initial]);
 return [value,setValue] as const;
}
