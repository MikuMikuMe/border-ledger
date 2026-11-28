import {describe, expect, it} from 'vitest';
import {parseReceipt} from '../src/domain/receipt';

describe('receipt suggestions', () => {
  it('extracts a labelled total and unambiguous date without guessing dollar currency', () => {
    expect(parseReceipt('SHOP NAME\n2026-11-22\nSUBTOTAL 12.00\nTAX 1.56\nTOTAL $13.56')).toMatchObject({merchant:'SHOP NAME',date:'2026-11-22',amount:'13.56',currency:null});
  });
  it('leaves ambiguous dates and conflicting totals unresolved', () => {
    expect(parseReceipt('SHOP\n01/02/2026\nTOTAL 12.00\nTOTAL 15.00')).toMatchObject({date:null,amount:null});
  });
});

import {applyReceiptSuggestions} from '../src/domain/receipt';
describe('receipt draft merging',()=>{
  it('does not overwrite fields edited during scanning and clears the default date only when unchanged',()=>{
    const before={merchant:'',date:'2026-11-23',amount:''};
    const current={merchant:'Edited',date:'2026-11-23',amount:''};
    expect(applyReceiptSuggestions(before,current,{merchant:'Shop',date:null,amount:'12.34',currency:null})).toEqual({merchant:'Edited',date:'',amount:'12.34'});
  });
});

it('keeps a locally recognized date when AI returns no date',()=>{
 const draft={merchant:'Shop',date:'2026-11-20',amount:'12.50'};
 expect(applyReceiptSuggestions(draft,draft,{merchant:null,date:null,amount:null,currency:null},false).date).toBe('2026-11-20');
});

it('clears an unedited conflicting amount but preserves a user edit',async()=>{
 const {mergeReceiptScan}=await import('../src/domain/receipt');
 const draft={merchant:'Shop',date:'2026-11-20',amount:'12.50',accountId:'a',currency:'CAD'};
 const suggestion={merchant:null,date:null,amount:null,currency:null};
 expect(mergeReceiptScan(draft,suggestion,new Set(),{allowed:['CAD'],clearMissingAmount:true}).amount).toBe('');
 expect(mergeReceiptScan(draft,suggestion,new Set(['amount']),{allowed:['CAD'],clearMissingAmount:true}).amount).toBe('12.50');
});
it('preserves a deliberate amount edit across replacement scans',async()=>{
 const {beginReceiptScan,mergeReceiptScan}=await import('../src/domain/receipt');
 const draft={merchant:'First',date:'2026-11-20',amount:'17.00',accountId:'a',currency:'CAD'};
 const edits=new Set<import('../src/domain/receipt').ReceiptEditField>(['amount','merchant']);
 beginReceiptScan(edits);
 expect(mergeReceiptScan(draft,{merchant:'Second',date:null,amount:null,currency:null},edits,{allowed:['CAD'],clearMissingAmount:true})).toMatchObject({merchant:'Second',amount:'17.00'});
});
it('fills a suggested category but preserves a user choice',async()=>{
 const {mergeReceiptScan,markReceiptEdits}=await import('../src/domain/receipt');
 const draft={merchant:'Metro',date:'2026-11-20',amount:'12.50',accountId:'a',currency:'CAD',category:''};
 const suggestion={merchant:'Metro',date:null,amount:null,currency:null,category:'Groceries'};
 expect(mergeReceiptScan(draft,suggestion,new Set(),{allowed:['CAD']}).category).toBe('Groceries');
 const edited={...draft,category:'Food'},edits=new Set<import('../src/domain/receipt').ReceiptEditField>();markReceiptEdits(draft,edited,edits);
 expect(mergeReceiptScan(edited,suggestion,edits,{allowed:['CAD']}).category).toBe('Food');
});

it('does not turn a negative refund total into a positive expense',()=>{
 expect(parseReceipt('SHOP\nREFUND\nTOTAL -12.50').amount).toBeNull();
});
