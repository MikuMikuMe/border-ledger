export type ReceiptSuggestion = {merchant:string|null; date:string|null; amount:string|null; currency:'CAD'|'USD'|null; category?:string|null};

function single(values:Set<string>) {return values.size===1?[...values][0]:null;}
function validDate([year,month,day]:readonly [string,string,string]) {
  const value=`${year}-${month}-${day}`,date=new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0,10)===value?value:null;
}
function northAmericanDate(match:RegExpMatchArray) {
  const first=Number(match[1]),second=Number(match[2]);
  if((first>12)===(second>12))return null;
  return first>12?validDate([match[3],match[2],match[1]]):validDate([match[3],match[1],match[2]]);
}
function receiptDate(lines:string[]) {
  const text=lines.join('\n');
  const iso=[...text.matchAll(/\b(20\d{2})[-/](\d{2})[-/](\d{2})\b/g)].map(match=>validDate([match[1],match[2],match[3]]));
  const local=[...text.matchAll(/\b(\d{2})[-/](\d{2})[-/](20\d{2})\b/g)].map(northAmericanDate);
  const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const named=[...text.matchAll(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2}),?\s+(20\d{2})\b/gi)].map(match=>validDate([match[3],String(months.indexOf(match[1].slice(0,3).toLowerCase())+1).padStart(2,'0'),match[2].padStart(2,'0')]));
  return single(new Set([...iso,...local,...named].filter((value):value is string=>value!==null)));
}
export function hasRefundOrNegativeTotal(text:string) {
  const normalized=text.replace(/^[ \t*=|~#_]+/gm,'');
  return /\brefund\b/i.test(normalized) || /^\s*(?:(?:(?:grand|rounded)\s+)?total|amount\s+due)\b[^\r\n]*[-−(]\s*\$?\s*\d/im.test(normalized) || /^\s*(?:(?:(?:grand|rounded)\s+)?total|amount\s+due)\s*:?\s*\r?\n\s*[-−(]\s*\$?\s*\d/im.test(normalized);
}
function totalOnNextLine(line:string,next:string|undefined) {
  if(!/^\s*(?:(?:(?:grand|rounded)\s+)?total|amount\s+due)\s*:?\s*$/i.test(line))return null;
  return next?.match(/^\s*\$?\s*(\d{1,7}(?:,\d{3})*\.\d{2})\s*$/)?.[1].replace(/,/g,'') ?? null;
}
function ambiguousSplitTotal(lines:string[]) {
  return lines.some((line,index)=>{
    const after=lines[index+2] ?? '';
    return totalOnNextLine(line,lines[index+1])!==null && /\btotal\b/i.test(after) && !/\bsubtotal\b/i.test(after);
  });
}
function taxExceedsTotal(lines:string[],total:string) {
  return lines.some(line=>{
    const tax=line.match(/^\s*tax\s*:?\s*\$?\s*(\d{1,7}(?:,\d{3})*\.\d{2})\s*$/i)?.[1];
    return tax!==undefined && Number(tax.replace(/,/g,''))>Number(total);
  });
}
function labeledTotals(lines:string[]) {
  const totals=new Set<string>();
  for(const [index,line] of lines.entries()) {
    if(!/^\s*(?:(?:(?:grand|rounded)\s+)?total|amount\s+due)\b/i.test(line)) continue;
    if(/^\s*(?:(?:grand|rounded)\s+)?total\s+(?:includes?|tax|gst|hst|pst|savings?|items?)\b/i.test(line)) continue;
    if(/[-−(]\s*\$?\s*\d/.test(line)) continue;
    const amounts=[...line.matchAll(/(?:\$\s*)?\b(\d{1,7}(?:,\d{3})*\.\d{2})\b/g)];
    if(amounts.length===1) totals.add(amounts[0][1].replace(/,/g,''));
    const next=totalOnNextLine(line,lines[index+1]);
    if(next) totals.add(next);
  }
  return single(totals);
}
function receiptTotal(lines:string[]) {
  if(hasRefundOrNegativeTotal(lines.join('\n'))) return null;
  lines=lines.map(line=>line.replace(/^[ \t*=|~#_]+/,''));
  if(ambiguousSplitTotal(lines))return null;
  const total=labeledTotals(lines);
  return total && !taxExceedsTotal(lines,total)?total:null;
}
function legibleMerchant(heading:string) {
  return !/[\uFFFD|]/.test(heading) && ((heading.match(/[a-z]/gi)??[]).length>=3 || /^[a-z]\s*&\s*[a-z]$/i.test(heading));
}
function receiptMerchant(heading:string|undefined) {
  return heading && legibleMerchant(heading) && /^[a-z]/i.test(heading) && !/^(receipt|invoice|tel|phone|date|total|subtotal|tax)\b/i.test(heading) && !/^(?:grocery|produce|deli|meat|dairy|bakery)$/i.test(heading) && !/^how did we do today\??$/i.test(heading) && !/\d{4,}/.test(heading)?heading.slice(0,160):null;
}
export function parseReceipt(text:string):ReceiptSuggestion {
  const lines=text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  const currencies=new Set((text.match(/\b(?:CAD|USD)\b/gi) ?? []).map(value=>value.toUpperCase()));
  return {merchant:receiptMerchant(lines[0]),date:receiptDate(lines),amount:receiptTotal(lines),currency:single(currencies) as 'CAD'|'USD'|null};
}
export function receiptScanMessage(suggestion:ReceiptSuggestion) {
  return suggestion.merchant && suggestion.date && suggestion.amount
    ? 'Review the suggested details before saving.'
    : 'Some details could not be identified. Review them or try another photo with the receipt flat, in focus, and evenly lit.';
}
export function receiptProviderMessage(result:{amountConflict:boolean;deletionRequested:boolean|null}) {
  const review=result.amountConflict?'The totals disagree. Verify and enter the amount before saving.':'Review the suggested details before saving.';
  return result.deletionRequested===false?`${review} Microsoft deletion could not be requested; its retention policy applies.`:review;
}
type ReceiptFields={merchant:string;date:string;amount:string};
export function applyReceiptSuggestions<T extends ReceiptFields>(before:T,current:T,suggestion:ReceiptSuggestion,clearMissingDate=true):T {
  return {...current,
    merchant:current.merchant===before.merchant?suggestion.merchant ?? current.merchant:current.merchant,
    date:current.date===before.date?suggestion.date ?? (clearMissingDate?'':current.date):current.date,
    amount:current.amount===before.amount?suggestion.amount ?? current.amount:current.amount};
}

export function applyReceiptCurrency<T extends {accountId:string;currency:string}>(before:T,current:T,currency:ReceiptSuggestion['currency'],allowed:readonly string[]):T {
  if(!currency || before.accountId!==current.accountId || before.currency!==current.currency || !allowed.includes(currency))return current;
  return {...current,currency};
}

export type ReceiptEditField='merchant'|'date'|'amount'|'accountId'|'currency'|'category';
type ReceiptDraft=ReceiptFields & {accountId:string;currency:string;category?:string};
export function markReceiptEdits(before:ReceiptDraft,after:ReceiptDraft,edits:Set<ReceiptEditField>) {
  for(const key of ['merchant','date','amount','accountId','currency','category'] as const)if(before[key]!==after[key])edits.add(key);
}
function removeEditedSuggestions(suggestion:ReceiptSuggestion,edits:Set<ReceiptEditField>):ReceiptSuggestion {
  return {...suggestion,merchant:edits.has('merchant')?null:suggestion.merchant,date:edits.has('date')?null:suggestion.date,amount:edits.has('amount')?null:suggestion.amount,currency:edits.has('accountId')||edits.has('currency')?null:suggestion.currency};
}
export function mergeReceiptScan<T extends ReceiptDraft>(current:T,suggestion:ReceiptSuggestion,edits:Set<ReceiptEditField>,{allowed,clearMissingDate=true,clearMissingAmount=false}:{allowed:readonly string[];clearMissingDate?:boolean;clearMissingAmount?:boolean}):T {
  const safe=removeEditedSuggestions(suggestion,edits);
  const fields=applyReceiptSuggestions(current,current,safe,clearMissingDate&&!edits.has('date'));
  const reconciled=clearMissingAmount && !edits.has('amount') && safe.amount===null?{...fields,amount:''}:fields;
  const category=!current.category && !edits.has('category') && safe.category?{...reconciled,category:safe.category}:reconciled;
  return applyReceiptCurrency(current,category,safe.currency,allowed);
}
