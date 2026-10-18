import {describe, expect, it,vi} from 'vitest';
import {formatMoney, reportQuery, reportView, filterActivity, mergeRows, recurringMessage, Resource, MutationGate} from '../mobile/src/features/finance/model';
import {report, transaction, stream, states} from './fixtures/mobile-finance';

describe('F02/F03 report lens', () => {
  it('uses the reporting timezone and configured Sunday week boundary', () => {
    expect(reportQuery('Week', new Date('2026-10-18T01:00:00Z'), {reportingTimezone:'America/Toronto',weekStart:0,preferredCurrency:null,revision:2,updatedAt:null},false,null,null)).toEqual({startDate:'2026-10-11',endDate:'2026-10-17',timeZone:'America/Toronto',includeProvisional:false,currency:null,reportingCurrency:null});
  });
  it('keeps source currencies separate and sorts chart dates with refund signs', () => {
    const view=reportView(report,false,null);
    expect(view.totals).toEqual([{currency:'CAD',amount:'1000'},{currency:'CNY',amount:'2000'}]);
    expect(view.lanes[0].points.map(p=>[p.date,p.amount])).toEqual([['2026-10-16','-200'],['2026-10-17','1200']]);
  });
  it('includes provisional only on request and never fabricates unavailable FX', () => {
    expect(reportView(report,true,null).totals[0].amount).toBe('1250');
    expect(reportView({...report,reportingCurrency:'USD'},true,null).totals).toEqual([]);
    expect(reportView({...report,reportingCurrency:'USD'},true,null).unavailable).toBe(true);
    expect(reportView({...report,reportingCurrency:'USD',convertedTotals:{confirmedMinorUnits:'999',provisionalMinorUnits:'1',confirmedCount:2,provisionalCount:1}},true,null).totals).toEqual([{currency:'USD',amount:'1000'}]);
  });
  it('formats decimal strings exactly above Number safe range and for zero/three decimals', () => {
    expect(formatMoney('9007199254740993','CAD')).toContain('90,071,992,547,409.93');
    expect(formatMoney('-2100','JPY')).toContain('2,100');
    expect(formatMoney('1234','KWD')).toContain('1.234');
    expect(formatMoney('1234','XDR')).not.toContain('.');
  });
  it('formats exact amounts when Hermes Intl rejects BigInt arguments',()=>{
    const original=Intl.NumberFormat.prototype.formatToParts;
    const spy=vi.spyOn(Intl.NumberFormat.prototype,'formatToParts').mockImplementation(function(this:Intl.NumberFormat,value?:number|bigint){if(typeof value==='bigint')throw new TypeError('Cannot convert BigInt to number');return original.call(this,value);});
    try{expect(formatMoney('9007199254740993','CAD')).toContain('90,071,992,547,409.93');expect(formatMoney('-1','CAD')).toContain('-');expect(formatMoney('-1','CAD')).toContain('0.01');}finally{spy.mockRestore();}
  });
});
describe('F04/F11 ordering, filters and view states', () => {
  it('searches provenance and applies every filter without changing order', () => {
    const other={...transaction,id:'other',currency:'CNY'};
    expect(filterActivity([other,transaction],{query:'rbc',currency:'CAD',category:'Food',status:'confirmed',source:'plaid'})).toEqual([transaction]);
    expect(filterActivity([transaction],{query:'missing'})).toEqual([]);
  });
  it('deduplicates pages with newer revisions, retaining server ordering', () => {
    expect(mergeRows([transaction],[{...transaction,revision:1},{...transaction,id:'next'}])).toEqual([transaction,{...transaction,id:'next'}]);
    expect(mergeRows([stream],[{...stream,revision:8}])[0].revision).toBe(8);
  });
  it('has truthful deterministic recurring source states', () => {
    expect(states.map(s=>recurringMessage(s))).toEqual([
      'No recurring streams match these filters.','Recurring history is still being prepared.',
      'Recurring history is incomplete; estimates are limited to observed coverage.',
      'Showing the last good recurring result; the source is stale.',
      'The recurring product is unavailable for this connection.','The recurring source reported an error.',
    ]);
  });
  it('ignores obsolete requests and clears cached content on authorization failure', async () => {
    const r=new Resource<string>(); let finish!:(s:string)=>void;
    const old=r.load(()=>new Promise(resolve=>{finish=resolve;}));
    await r.load(async()=>'new'); finish('old'); await old;
    expect(r.current().data).toBe('new');
    await r.load(async()=>{throw {code:'offline'};});
    expect(r.current()).toMatchObject({data:'new',phase:'offline'});
    await r.load(async()=>{throw {code:'unauthorized'};});
    expect(r.current()).toMatchObject({data:null,phase:'locked'});
  });
  it('disposal suppresses a late read', async()=>{
    const r=new Resource<string>(); let finish!:(s:string)=>void;
    const pending=r.load(()=>new Promise(resolve=>{finish=resolve;})); r.dispose(); finish('secret'); await pending;
    expect(r.current().data).toBeNull();
  });
});
describe('F04/F13 native durable writes',()=>{
  const op=(status:string)=>({operationId:'fixture_op_1',kind:'annotate',status,updatedAt:'2026-10-17T00:00:00Z',resultId:null});
  it('does not replay a lost promise and queries the durable receipt',async()=>{
    const gate=new MutationGate(); let writes=0;
    await gate.recover(async()=>[]);
    await gate.submit('fixture_op_1',async()=>{writes++;throw {code:'interrupted'};},async()=>op('reconciliation_required'));
    await gate.submit('fixture_op_2',async()=>{writes++;return op('completed');},async()=>null);
    expect(writes).toBe(1); expect(gate.current().blocked).toBe(true);
  });
  it('recovers every operation page before allowing a write',async()=>{
    const gate=new MutationGate();
    await gate.recover(async offset=>offset===0?Array.from({length:100},(_,i)=>({...op('completed'),operationId:`fixture_${i}`})):[op('running')]);
    expect(gate.current().blocked).toBe(true);
  });
  it('distinguishes revision conflict from success and preserves the draft in the caller',async()=>{
    const gate=new MutationGate(); await gate.recover(async()=>[]);
    await gate.submit('fixture_op_1',async()=>op('revision_conflict'),async()=>null);
    expect(gate.current()).toMatchObject({blocked:false,status:'revision_conflict'});
  });
  it('treats a definitive server rejection as terminal rather than an unresolved write',async()=>{
    const gate=new MutationGate(); await gate.recover(async()=>[]);
    await gate.submit('fixture_op_1',async()=>op('rejected'),async()=>null);
    expect(gate.current()).toEqual({blocked:false,status:'rejected'});
  });
  it('does not let a recovery read unlock a write before its native journal claim',async()=>{
    const gate=new MutationGate();await gate.recover(async()=>[]);let finish!:(value:any)=>void;
    const write=gate.submit('fixture_op_1',()=>new Promise(resolve=>{finish=resolve;}),async()=>null);
    await gate.recover(async()=>[]);expect(gate.current()).toMatchObject({blocked:true,status:'saving'});
    finish(op('completed'));await write;
  });
  it('invalidates an older empty recovery after a newer recovery permits an unresolved submission',async()=>{
    const gate=new MutationGate();let finish!:(value:any)=>void;
    const oldRecovery=gate.recover(()=>new Promise(resolve=>{finish=resolve;}));
    await gate.recover(async()=>[]);
    await gate.submit('fixture_op_1',async()=>op('reconciliation_required'),async()=>null);
    finish([]);await oldRecovery;
    expect(gate.current()).toEqual({blocked:true,status:'reconciliation_required'});
    let writes=0;await gate.submit('fixture_op_2',async()=>{writes++;return op('completed');},async()=>null);
    expect(writes).toBe(0);
  });
  it.each(['pending','failure'])('ignores superseded recovery %s results',async outcome=>{
    const gate=new MutationGate();let finish!:(value:any)=>void;let reject!:(error:any)=>void;
    const oldRecovery=gate.recover(()=>new Promise((resolve,fail)=>{finish=resolve;reject=fail;}));
    await gate.recover(async()=>[]);
    if(outcome==='pending')finish([op('running')]);else reject({code:'offline'});
    await oldRecovery;expect(gate.current()).toEqual({blocked:false,status:'ready'});
  });
});
