import type {ValidatedFxRates} from './fx-rates';
function quote(currency:string,rates:ValidatedFxRates):number|null {
  if(currency==='EUR') return 1;
  const value=Number(rates.rates[currency]);
  return Number.isFinite(value) && value>0 ? value : null;
}
export function describeFxRate(source:string,target:string,rates:ValidatedFxRates):string|null {
  const from=quote(source,rates),to=quote(target,rates);
  if(from===null || to===null) return null;
  const ratio=to/from;
  if(!Number.isFinite(ratio) || ratio<=0) return null;
  return Number(ratio.toPrecision(8)).toString();
}
