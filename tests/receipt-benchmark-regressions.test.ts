import {describe,expect,it} from 'vitest';
import {parseReceipt,receiptScanMessage} from '../src/domain/receipt';

describe('receipt extraction with noisy photographs',()=>{
  it('leaves visibly corrupted or extremely short merchant headings blank',()=>{
    expect(parseReceipt('A | \uFFFD\nTOTAL 12.00').merchant).toBeNull();
    expect(parseReceipt('XY\nTOTAL 12.00').merchant).toBeNull();
    expect(parseReceipt('A&W\nTOTAL 12.00').merchant).toBe('A&W');
    expect(parseReceipt('SHOP 7\nTOTAL 12.00').merchant).toBe('SHOP 7');
  });
  it('recognizes a total printed on the next line while keeping conflicting amounts unresolved',()=>{
    expect(parseReceipt('STORE\nSUBTOTAL 10.00\nTOTAL\n$11.30\nCASH 20.00').amount).toBe('11.30');
    expect(parseReceipt('STORE\nTOTAL\n11.30\nTOTAL 12.00').amount).toBeNull();
    expect(parseReceipt('STORE\nTOTAL TAX\n1.30').amount).toBeNull();
    expect(parseReceipt('STORE\nTOTAL\n-11.30').amount).toBeNull();
    expect(parseReceipt('STORE\nTOTAL 11.30\nAMOUNT DUE\n-11.30').amount).toBeNull();
    expect(parseReceipt('STORE\nTOTAL\n12.00 15.00').amount).toBeNull();
  });
  it('offers retake guidance when key receipt details are missing',()=>{
    expect(receiptScanMessage({merchant:'STORE',date:null,amount:null,currency:null})).toContain('try another photo');
    expect(receiptScanMessage({merchant:'STORE',date:'2026-11-20',amount:'12.00',currency:null})).toBe('Review the suggested details before saving.');
  });
  it('recognizes a total preceded by decorative punctuation without using subtotals',()=>{
    expect(parseReceipt('STORE\n*** TOTAL: $11.30').amount).toBe('11.30');
    expect(parseReceipt('STORE\n= TOTAL: -11.30').amount).toBeNull();
    expect(parseReceipt('STORE\n*** SUBTOTAL: 11.30').amount).toBeNull();
    expect(parseReceipt('STORE\n*** TOTAL TAX: 1.30').amount).toBeNull();
  });
  it('does not use a tax value as a total when text columns are misaligned',()=>{
    expect(parseReceipt('STORE\nSUBTOTAL\nTAX 476.88\n**** TOTAL 22.28').amount).toBeNull();
  });
  it('does not pair a split total with a value next to another total label',()=>{
    expect(parseReceipt('STORE\nTOTAL TAX:\n77.49\nTOTAL:\n38.75\nReceipt Total:').amount).toBeNull();
  });
});
