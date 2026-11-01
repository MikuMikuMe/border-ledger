import {getCurrencyMeta} from '../domain/currencies';
import {formatMoney} from '../domain/format';
export const money=(value:number|null,currency:string)=>value===null?'Unavailable':formatMoney(value,currency);
export function decimalAmount(value:number,currency:string) {
 const digits=getCurrencyMeta(currency)?.minorUnitDigits??2,negative=value<0,n=BigInt(Math.abs(value)),scale=10n**BigInt(digits);
 return (negative?'-':'')+(digits?`${n/scale}.${(n%scale).toString().padStart(digits,'0')}`:n.toString());
}
