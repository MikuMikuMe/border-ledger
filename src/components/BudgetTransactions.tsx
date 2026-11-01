import type {BudgetActivity} from './BudgetTypes';
import {money} from './budget-display';
function CountedTransaction({item,currency}:{item:BudgetActivity;currency:string}) {
 return <div className="budget-balance"><div><strong>{item.category} · {item.date}</strong><p>{item.kind}</p><p>Original {money(item.sourceMinor,item.sourceCurrency)}{item.sourceCurrency!==currency?` · Approx. rate ${item.rate??'unavailable'} · Rate date ${item.rateDate??'unavailable'}`:''}</p></div><strong>{money(item.activityMinor,currency)}</strong></div>;
}
export function BudgetTransactions({activity,currency,tracking=false}:{activity:BudgetActivity[];currency:string;tracking?:boolean}) {
 return <details className="budget-section"><summary>View counted transactions</summary><p>{tracking?'Confirmed income, spending, fees and refunds for this month.':'Confirmed spending and refunds since the budget started.'} Converted amounts use the transaction’s stored date.</p>{activity.length?activity.map(item=><CountedTransaction key={item.id} item={item} currency={currency}/>):<p>No confirmed budget activity in this period.</p>}</details>;
}
