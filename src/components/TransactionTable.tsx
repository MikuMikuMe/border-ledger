import {Filter} from 'lucide-react';
import {formatDate,formatMoney} from '../domain/format';
import type {Transaction} from '../domain/types';

function transactionSourceLabel(source:Transaction['source']){
  if(source==='plaid')return 'Plaid';
  if(source==='alert')return 'BOC alert';
  if(source==='manual')return 'Manual';
  if(String(source)==='lunchflow')return 'Lunch Flow';
  return 'Statement';
}

export function StateBadge({status}:{status:Transaction['status']}){
  const label=status==='needs_review'?'Needs review':status==='provisional'?'Provisional':'Confirmed';
  return <span className={`state-badge ${status}`}><span className="state-dot"/>{label}</span>;
}

export function TransactionTable({transactions,compact=false,onOpen}:{transactions:Transaction[];compact?:boolean;onOpen?(transaction:Transaction):void}){
  return <div className={`transaction-table-wrap ${compact?'is-compact':''}`}><table className="transaction-table"><thead><tr><th scope="col">Date</th><th scope="col">Merchant</th><th scope="col">Category</th><th scope="col">Source</th><th scope="col">State</th><th scope="col" className="amount-cell">Amount</th></tr></thead><tbody>{transactions.map(transaction=><tr key={transaction.id} className={onOpen?'transaction-row-open':undefined} onClick={onOpen?event=>{event.currentTarget.querySelector('button')?.focus();onOpen(transaction);}:undefined}><td className="date-cell">{formatDate(transaction.date)}</td><td>{onOpen?<button type="button" className="merchant-name transaction-open">{transaction.merchant}</button>:<strong className="merchant-name">{transaction.merchant}</strong>}{transaction.note?<small className="note-line">{transaction.note}</small>:null}</td><td><span className={`category-mark ${transaction.currency.toLowerCase()}`}/>{transaction.category}</td><td><span className="source-name">{transactionSourceLabel(transaction.source)}</span></td><td><StateBadge status={transaction.status}/></td><td className={`amount-cell ${transaction.kind==='refund'||transaction.kind==='income'?'is-credit':''}`}>{transaction.kind==='income'||transaction.kind==='refund'?'+':transaction.kind==='transfer'?'↔ ':'− '}{formatMoney(Math.abs(transaction.amountMinor),transaction.currency,{signDisplay:'never'})}</td></tr>)}</tbody></table>{transactions.length===0?<div className="empty-state"><Filter size={22}/><strong>No records match that filter.</strong><span>Try a wider search or clear one of the filters.</span></div>:null}</div>;
}
