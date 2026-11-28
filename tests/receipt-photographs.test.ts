import {describe,expect,it} from 'vitest';
import {parseReceipt} from '../src/domain/receipt';

describe('receipt patterns observed in public photographed samples',()=>{
  it('does not treat tax included in a total as the purchase total',()=>{
    expect(parseReceipt('SHOP\nTOTAL INCLUDES GST OF 0.35').amount).toBeNull();
  });
  it('does not treat grand-total tax summaries as a purchase total',()=>{
    expect(parseReceipt('SHOP\nGRAND TOTAL INCLUDES GST OF 0.35').amount).toBeNull();
  });
  it('recognizes amount due',()=>{
    expect(parseReceipt('SHOP\nAmount Due 51.95').amount).toBe('51.95');
  });
  it('recognizes dates with a spelled month',()=>{
    expect(parseReceipt('SHOP\nMar 22, 2026\nGrand Total 15.45').date).toBe('2026-03-22');
  });
  it('does not infer a merchant from a cropped department heading',()=>{
    expect(parseReceipt('GROCERY\nTOTAL 16.21').merchant).toBeNull();
  });
  it('accepts a merchant name that starts with a department word',()=>{
    expect(parseReceipt('GROCERY OUTLET\nTOTAL 16.21').merchant).toBe('GROCERY OUTLET');
  });
  it('does not choose a positive total for a negative amount due',()=>{
    expect(parseReceipt('SHOP\nTOTAL 12.50\nAMOUNT DUE -12.50').amount).toBeNull();
  });
  it('leaves conflicting totals for review',()=>{
    expect(parseReceipt('SHOP\nTOTAL 9.15\nCASHBACK 20.00\nTOTAL 29.15').amount).toBeNull();
  });
  it('does not infer a merchant from a damaged OCR heading',()=>{
    expect(parseReceipt('(FE gta Te, SUC\nTOTAL 5.35').merchant).toBeNull();
  });
});

it('does not use a department or survey prompt as the merchant',()=>{
 expect(parseReceipt('DELI\nmetro\nTOTAL\n6.22').merchant).toBeNull();
 expect(parseReceipt('HOW DID WE DO TODAY?\nSURVEY.WALMART.CA\nTOTAL\n237.02').merchant).toBeNull();
 expect(parseReceipt('MEAT\nTOTAL 20.00').merchant).toBeNull();
 expect(parseReceipt('DELI PLANET\nTOTAL 20.00').merchant).toBe('DELI PLANET');
});

it('does not suggest the pre-rounding total when the receipt has a different rounded total',()=>{
 expect(parseReceipt('STORE\nTOTAL 6.22\nROUNDED TOTAL 6.20\nCASH 10.00').amount).toBeNull();
 expect(parseReceipt('STORE\nROUNDED TOTAL 6.20').amount).toBe('6.20');
 expect(parseReceipt('STORE\nROUNDED TOTAL -6.20').amount).toBeNull();
});

it('does not treat an adjacent tax amount as the purchase total',()=>{
 expect(parseReceipt('STORE\nTOTAL TAX 12.50').amount).toBeNull();
 expect(parseReceipt('STORE\nTOTAL 12.50 13.50').amount).toBeNull();
});
