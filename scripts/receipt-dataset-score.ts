type Label={index:number;text:string};
type Suggestion={merchant:string|null;date:string|null;amount:string|null};
type Row={id:number;suggestion:Suggestion};
type Counts={labeled:number;correct:number;different:number;blank:number};

function merchant(value:unknown) {return typeof value==='string'?value.toLowerCase().replace(/[^a-z0-9]/g,''):'';}
function date(value:unknown) {return typeof value==='string'?value:'';}
function amount(value:unknown) {
  if(typeof value!=='string' && typeof value!=='number')return '';
  const match=String(value).replace(/[$,\s]/g,'').match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if(!match)return '';
  const whole=match[2].replace(/^0+(?=\d)/,'');
  const result=`${match[1]}${whole}.${(match[3]??'').padEnd(2,'0')}`;
  return result==='0.00'?'':result;
}
function counts():Counts {return {labeled:0,correct:0,different:0,blank:0};}
function record(count:Counts,truth:string,predicted:string) {
  if(!truth)return;
  count.labeled++;
  if(!predicted)count.blank++;else if(predicted===truth)count.correct++;else count.different++;
}
export function scoreReceiptRows(labels:Label[],rows:Row[]) {
  const expected=new Map(labels.map(row=>[row.index,JSON.parse(row.text) as Record<string,unknown>]));
  const result={merchant:counts(),date:counts(),amount:counts()};
  const fields=[['merchant','merchantName',merchant],['date','date',date],['amount','total',amount]] as const;
  for(const row of rows) {
    const label=expected.get(row.id);
    if(!label)throw new Error(`Missing label for image ${row.id}`);
    for(const [field,key,normalize] of fields) {
      record(result[field],normalize(label[key]),normalize(row.suggestion[field]));
    }
  }
  return result;
}
