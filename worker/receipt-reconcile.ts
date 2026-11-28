import {hasRefundOrNegativeTotal,parseReceipt,type ReceiptSuggestion} from '../src/domain/receipt';

export function reconcileReceiptTotal(suggestion:ReceiptSuggestion,text:string) {
  const local=parseReceipt(text),amountConflict=!!local.amount && !!suggestion.amount && local.amount!==suggestion.amount;
  return {suggestion:{...suggestion,amount:amountConflict || hasRefundOrNegativeTotal(text)?null:suggestion.amount},amountConflict};
}
