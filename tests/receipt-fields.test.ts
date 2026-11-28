import {describe,it,expect} from 'vitest';
import {parseReceipt,applyReceiptCurrency} from '../src/domain/receipt';
describe('receipt date and currency',()=>{
 it('recognizes unambiguous Canadian and US dates without guessing ambiguous ones',()=>{
  expect(parseReceipt('SHOP\n11/23/2026\nTOTAL 5.00').date).toBe('2026-11-23');
  expect(parseReceipt('SHOP\n23/11/2026\nTOTAL 5.00').date).toBe('2026-11-23');
  expect(parseReceipt('SHOP\n11/12/2026\nTOTAL 5.00').date).toBeNull();
 });
 it('applies explicit currency only if the user has not changed the account or currency and it is allowed',()=>{
  const initial={accountId:'a',currency:'CAD'};
  expect(applyReceiptCurrency(initial,initial,'USD',['CAD','USD']).currency).toBe('USD');
  expect(applyReceiptCurrency(initial,{accountId:'b',currency:'CAD'},'USD',['CAD','USD']).currency).toBe('CAD');
  expect(applyReceiptCurrency(initial,initial,'USD',['CAD']).currency).toBe('CAD');
 });
});
