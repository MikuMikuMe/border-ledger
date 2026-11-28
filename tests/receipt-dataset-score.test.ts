import {expect,it} from 'vitest';
import {scoreReceiptRows} from '../scripts/receipt-dataset-score';

it('counts matching, differing, missing, and unavailable receipt fields separately',()=>{
  const labels=[
    {index:1,text:JSON.stringify({merchantName:'A & W',date:'2026-01-01',total:12.5})},
    {index:2,text:JSON.stringify({merchantName:'Shop',date:'2026-02-02',total:8})},
    {index:3,text:JSON.stringify({merchantName:null,date:null,total:null})},
  ];
  const rows=[
    {id:1,suggestion:{merchant:'A&W',date:'2026-01-01',amount:'12.50'}},
    {id:2,suggestion:{merchant:'Other',date:null,amount:null}},
    {id:3,suggestion:{merchant:'Any',date:null,amount:'1.00'}},
  ];
  expect(scoreReceiptRows(labels,rows)).toEqual({
    merchant:{labeled:2,correct:1,different:1,blank:0},
    date:{labeled:2,correct:1,different:0,blank:1},
    amount:{labeled:2,correct:1,different:0,blank:1},
  });
});
