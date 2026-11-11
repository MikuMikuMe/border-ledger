import {useState} from 'react';
import {ChevronDown} from 'lucide-react';
import {useDismissible} from './useDismissible';

export type ChartRange='daily'|'weekly'|'monthly';
export const chartRangeLabels:Record<ChartRange,string>={daily:'Daily',weekly:'Weekly',monthly:'Monthly'};

export function ChartRangePicker({range,onChange}:{range:ChartRange;onChange(value:ChartRange):void}){
  const [open,setOpen]=useState(false);
  const {container,dismiss}=useDismissible(open,()=>setOpen(false));
  return <div className="chart-range-control" ref={container}><button type="button" className="quiet-button" onClick={()=>setOpen(value=>!value)} aria-expanded={open} aria-controls="chart-range-menu">{chartRangeLabels[range]} <ChevronDown size={15}/></button>{open?<div id="chart-range-menu" className="chart-range-menu" role="region" aria-label="Chart period options">{(Object.keys(chartRangeLabels) as ChartRange[]).map(value=><button type="button" key={value} className={range===value?'is-selected':undefined} onClick={()=>{onChange(value);dismiss();}}>{chartRangeLabels[value]}</button>)}</div>:null}</div>;
}
