import {describe,it,expect} from 'vitest';
import {transactionDraft} from '../mobile/src/features/finance/transactionDraft';
import type {Transaction} from '../mobile/src/features/finance/contracts';
const transaction:Transaction={id:'tx',occurredAt:'2026-10-25',currency:'CAD',signedMinorUnits:'1234',sourceAmountMinor:'-1234',merchant:'Store',accountId:'account',accountLabel:null,status:'confirmed',sourceLabel:'manual',category:'Food',note:null,kind:'transfer',revision:2,editRevision:1};
describe('transaction editor draft',()=>{
 it('preserves account, date, precision, and transfer direction',()=>{
  expect(transactionDraft(transaction)).toMatchObject({accountId:'account',date:'2026-10-25',amount:'12.34',direction:'out',kind:'transfer',category:'Food'});
  expect(transactionDraft({...transaction,currency:'JPY',sourceAmountMinor:'2500'})).toMatchObject({amount:'2500',direction:'in'});
 });
 it('refuses a snapshot lacking source amount or edit revision',()=>{
  expect(()=>transactionDraft({...transaction,editRevision:null})).toThrow();
  expect(()=>transactionDraft({...transaction,sourceAmountMinor:null})).toThrow();
 });
});
