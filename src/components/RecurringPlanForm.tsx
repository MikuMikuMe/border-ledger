import type { Dispatch, FormEventHandler, SetStateAction } from 'react';
import type { AccountOption, Draft } from './RecurringPlans';

export function RecurringPlanForm({draft,setDraft,accounts,accountCurrencies,busy,onSubmit}:{draft:Draft;setDraft:Dispatch<SetStateAction<Draft|null>>;accounts:AccountOption[];accountCurrencies:{accountId:string;currency:string}[];busy:boolean;onSubmit:FormEventHandler<HTMLFormElement>}) {
  return <form onSubmit={onSubmit} className="recurring-plan-form">
      <label>Account<select required value={draft.accountId} onChange={e=>{const account=accounts.find(item=>item.id===e.target.value);setDraft({...draft,accountId:e.target.value,currency:account?.currency ?? draft.currency});}}>{accounts.map(account=><option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select></label>
      <label>Payee<input required maxLength={120} value={draft.merchant} onChange={e=>setDraft({...draft,merchant:e.target.value})}/></label>
      <label>Amount<input required inputMode="decimal" value={draft.amount} onChange={e=>setDraft({...draft,amount:e.target.value})}/></label>
      <label>Currency<select value={draft.currency} onChange={e=>setDraft({...draft,currency:e.target.value})}>{[...new Set([draft.currency,...accountCurrencies.filter(item=>item.accountId===draft.accountId).map(item=>item.currency)])].map(code=><option key={code}>{code}</option>)}</select></label>
      <label>Direction<select value={draft.direction} onChange={e=>setDraft({...draft,direction:e.target.value as Draft['direction']})}><option value="expense">Expense</option><option value="income">Income</option></select></label>
      <label>Repeats<select value={draft.frequency} onChange={e=>setDraft({...draft,frequency:e.target.value as Draft['frequency']})}><option value="weekly">Weekly</option><option value="biweekly">Every two weeks</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label>
      <label>First date<input required type="date" value={draft.startDate} onChange={e=>setDraft({...draft,startDate:e.target.value})}/></label><label>End date (optional)<input type="date" value={draft.endDate} onChange={e=>setDraft({...draft,endDate:e.target.value})}/></label>
      <div><button className="outline-button" disabled={busy} type="submit">Save plan</button> <button className="quiet-button" type="button" onClick={()=>setDraft(null)}>Cancel</button></div>
    </form>;
}
