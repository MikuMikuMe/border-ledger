import type {ReceiptSuggestion} from '../src/domain/receipt';
export function record(value:unknown):Record<string,unknown> {return value && typeof value==='object' && !Array.isArray(value)?value as Record<string,unknown>:{};}
function validDate(value:unknown) {
  if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  const date=new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0,10)===value?value:null;
}
function receiptAmount(value:unknown) {
  const field=record(value),amount=record(field.valueCurrency).amount ?? field.valueNumber;
  if(typeof amount!=='number' || !Number.isFinite(amount))return null;
  if(amount<=0 || amount>=10000000)return null;
  return Math.abs(amount*100-Math.round(amount*100))<1e-7?amount.toFixed(2):null;
}
function receiptCurrency(value:unknown) {
  const field=record(value),content=typeof field.content==='string'?field.content:'';
  const currencies=new Set((content.match(/\b(?:CAD|USD)\b/gi)??[]).map(item=>item.toUpperCase()));
  const code=record(field.valueCurrency).currencyCode;
  if(code==='CAD' || code==='USD')currencies.add(code);
  return currencies.size===1?[...currencies][0] as 'CAD'|'USD':null;
}
function receiptMerchant(value:unknown) {
  const merchant=record(value).valueString;
  return typeof merchant==='string' && merchant.trim() && merchant.length<=160?merchant.trim():null;
}
export function azureReceiptFields(value:unknown):ReceiptSuggestion {
  const docs=record(record(value).analyzeResult).documents;
  const fields=Array.isArray(docs) && docs.length===1?record(record(docs[0]).fields):{};
  return {merchant:receiptMerchant(fields.MerchantName),date:validDate(record(fields.TransactionDate).valueDate),amount:receiptAmount(fields.Total),currency:receiptCurrency(fields.Total)};
}
