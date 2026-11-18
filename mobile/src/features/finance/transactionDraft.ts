import {getCurrencyMeta} from '../../../../src/domain/currencies';
import type {Transaction} from './contracts';
import type {ManualDraft} from './ManualEntryForm';

function requireEditable(transaction:Transaction):asserts transaction is Transaction & {accountId:string;sourceAmountMinor:string;editRevision:number} {
 if(!transaction.accountId||transaction.sourceAmountMinor==null||transaction.editRevision==null)throw new Error('Refresh Activity before editing this transaction.');
}
function decimalAmount(value:string,precision:number) {
 const minor=BigInt(value),absolute=(minor<0n?-minor:minor).toString().padStart(precision+1,'0');
 return precision===0?absolute:`${absolute.slice(0,-precision)}.${absolute.slice(-precision)}`;
}
export function transactionDraft(transaction:Transaction):ManualDraft {
 requireEditable(transaction);
 const {accountId,sourceAmountMinor,currency}=transaction;
 const precision=getCurrencyMeta(currency)?.minorUnitDigits;
 if(precision===undefined)throw new Error('Unsupported currency.');
 if(!/^-?\d+$/.test(sourceAmountMinor))throw new Error('Invalid transaction amount.');
 const minor=BigInt(sourceAmountMinor),amount=decimalAmount(sourceAmountMinor,precision);
 return {accountId,date:transaction.occurredAt.slice(0,10),merchant:transaction.merchant??'',amount,currency,kind:transaction.kind,direction:minor<0n?'out':'in',category:transaction.category??'',note:transaction.note??''};
}
