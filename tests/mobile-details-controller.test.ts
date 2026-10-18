import {describe,it,expect} from 'vitest';
import {DetailsController,reviewDisabledReason} from '../mobile/src/features/details/DetailsController';
import {MutationGate} from '../mobile/src/features/finance/model';
import {detail,alert,account,connection,link,receipt} from './fixtures/mobile-details';
import type {DetailsPorts,LinkSnapshot} from '../mobile/src/features/details/contracts';

function fixture(){
  const writes:unknown[]=[];const reads:unknown[]=[];let emit=(value:LinkSnapshot)=>{};let reviewChanged=()=>{};let removed=0;let snapshot:LinkSnapshot=link;
  const op=async(kind:string,...args:unknown[])=>{writes.push([kind,...args]);return receipt(String(args[0]),kind);};
  const ports:DetailsPorts={
    session:{readOperations:async()=>[],queryOperation:async()=>null},
    recurring:{readDetail:async(...args)=>{reads.push(args);return detail;},startClassify:async(...args)=>op('recurring_classify',...args),onChanged:()=>({remove:()=>{removed++;}})},
    review:{readAlerts:async(...args)=>{reads.push(args);return {items:[alert],nextCursor:null,limit:50};},startReview:async(...args)=>op('review',...args),startAnnotate:async(...args)=>op('annotate',...args),onChanged:cb=>{reviewChanged=cb;return {remove:()=>{removed++;}};}},
    accounts:{getSnapshot:async()=>snapshot,readAccounts:async(...args)=>{reads.push(args);return {accounts:[account],nextCursor:null,limit:50};},readConnections:async()=>[connection],startConnect:async(...args)=>op('plaid',...args),startSelectAccounts:async(...args)=>op('select_accounts',...args),startCancelPending:async(...args)=>op('cancel_pending',...args),startSync:async(...args)=>op('bank_sync',...args),startDisconnect:async(...args)=>op('disconnect',...args),onStateChanged:cb=>{emit=cb;return {remove:()=>{removed++;}};}},
  };
  return {ports,writes,reads,emit:(value:LinkSnapshot)=>{snapshot=value;emit(value);},reviewChanged:()=>reviewChanged(),removed:()=>removed};
}
describe('second-stage native financial controller',()=>{
  it('reads the native linking snapshot after preparation without treating it as a completed write',async()=>{
    const f=fixture(),c=new DetailsController(f.ports);await c.start();
    let progressReads=0,linkStarts=0;
    f.ports.accounts.startConnect=async op=>{linkStarts++;f.ports.accounts.getSnapshot=async()=>{progressReads++;return {...link,state:'linking'};};return {...receipt(op,'plaid'),status:'awaiting_result'};};
    await c.connect('link');expect(c.accounts.current().data?.link.state).toBe('linking');expect(progressReads).toBe(1);expect(c.mutation.current()).toEqual({blocked:true,status:'awaiting_result'});expect(linkStarts).toBe(1);c.dispose();
  });
  it('completes native Plaid success, then activates only explicitly selected accounts after receipt recovery',async()=>{
    const f=fixture(),c=new DetailsController(f.ports);await c.start();
    f.ports.accounts.startConnect=async op=>{f.writes.push(['plaid',op]);return {...receipt(op,'plaid'),status:'awaiting_result'};};
    await c.connect('link');expect(c.mutation.current().blocked).toBe(true);
    f.emit({...link,state:'pending',outcomeCode:'success',pendingConnectionId:'pending_1',accounts:[account]});
    f.ports.session.readOperations=async()=>[receipt('link','plaid')];await c.recover();
    f.ports.accounts.startSelectAccounts=async(...args)=>{f.writes.push(['select_accounts',...args]);f.emit({...link,state:'connected',outcomeCode:'success',connectionId:'connection_1'});return receipt(args[0],'select_accounts');};
    await c.selectAccounts('select',['account_1']);expect(c.accounts.current().data?.link.state).toBe('connected');expect(c.mutation.current().status).toBe('completed');
    expect(f.writes).toEqual([['plaid','link'],['select_accounts','select','pending_1',['account_1']]]);c.dispose();
  });
  it('pages Review and Accounts with the server cursor and deduplicates only matching IDs',async()=>{
    const f=fixture();f.ports.review.readAlerts=async cursor=>({items:[cursor?{...alert,eventId:'second'}:alert],nextCursor:cursor?null:'review_next',limit:50});f.ports.accounts.readAccounts=async cursor=>({accounts:[cursor?{...account,providerAccountId:'second'}:account],nextCursor:cursor?null:'accounts_next',limit:50});
    const c=new DetailsController(f.ports);await c.start();await c.loadReview(true);await c.loadAccounts(true);
    expect(c.review.current().data?.items.map(a=>a.eventId)).toEqual([alert.eventId,'second']);expect(c.accounts.current().data?.page.accounts.map(a=>a.providerAccountId)).toEqual(['account_1','second']);c.dispose();
  });
  it('locks on a mutation authorization rejection and never queries or publishes protected content afterward',async()=>{
    const f=fixture(),c=new DetailsController(f.ports);await c.start();let queries=0;f.ports.accounts.startSync=async()=>{throw {code:'unauthorized'};};f.ports.session.queryOperation=async()=>{queries++;return receipt('sync','bank_sync');};
    await c.sync('sync');expect(c.accounts.current().phase).toBe('locked');expect(queries).toBe(0);c.dispose();
  });
  it('loads recurring history pages without losing exact source money or the highest revision',async()=>{
    const f=fixture(),c=new DetailsController(f.ports);await c.start();await c.openRecurring('fixture_stream');
    f.ports.recurring.readDetail=async()=>({...detail,stream:{...detail.stream,revision:2},history:[detail.history[0],{...detail.history[0],providerTransactionId:'payment_2',currency:'JPY',amountMinor:'9007199254740993'}],nextCursor:null});
    await c.loadDetail(true);expect(c.detail.current().data?.history).toHaveLength(2);
    expect(c.detail.current().data?.stream.revision).toBe(4);expect(c.detail.current().data?.history[1]).toMatchObject({currency:'JPY',amountMinor:'9007199254740993'});
    await c.classify('classify','excluded');expect(f.writes).toEqual([['recurring_classify','classify','fixture_stream',4,'excluded']]);c.dispose();
  });
  it('requires explicit detail refresh after a conflict before a deliberate classification at the fresh revision',async()=>{
    const f=fixture(),c=new DetailsController(f.ports);await c.start();await c.openRecurring('fixture_stream');
    f.ports.recurring.startClassify=async(...args)=>{f.writes.push(['recurring_classify',...args]);return {...receipt(args[0],'recurring_classify'),status:args[0]==='first'?'revision_conflict':'completed'};};
    f.ports.session.readOperations=async()=>[{...receipt('first','recurring_classify'),status:'revision_conflict'}];
    await c.classify('first','excluded');expect(c.mutation.current()).toEqual({blocked:false,status:'revision_conflict'});
    c.closeRecurring();f.ports.recurring.readDetail=async()=>({...detail,stream:{...detail.stream,revision:8}});await c.openRecurring('fixture_stream');
    await c.classify('before_refresh','bill');expect(f.writes).toHaveLength(1);
    await c.loadDetail(false,{recoverConflict:true});expect(c.detail.current().data?.stream.revision).toBe(8);expect(c.mutation.current()).toEqual({blocked:false,status:'ready'});expect(f.writes).toHaveLength(1);
    await c.classify('deliberate','bill');expect(f.writes).toEqual([['recurring_classify','first','fixture_stream',4,'excluded'],['recurring_classify','deliberate','fixture_stream',8,'bill']]);c.dispose();
  });
  it('does not clear a classification conflict when explicit detail refresh fails offline',async()=>{
    const f=fixture(),c=new DetailsController(f.ports);await c.start();await c.openRecurring('fixture_stream');let recoveryReads=0;
    f.ports.recurring.startClassify=async op=>({...receipt(op,'recurring_classify'),status:'revision_conflict'});await c.classify('first','excluded');
    f.ports.recurring.readDetail=async()=>{throw {code:'offline'};};f.ports.session.readOperations=async()=>{recoveryReads++;return [];};
    await c.loadDetail(false,{recoverConflict:true});expect(c.detail.current().phase).toBe('offline');expect(c.mutation.current().status).toBe('revision_conflict');expect(recoveryReads).toBe(0);c.dispose();
  });
  it('keeps a newly discovered ambiguous receipt blocked after explicit conflict refresh and never retries classification',async()=>{
    const f=fixture(),c=new DetailsController(f.ports);await c.start();await c.openRecurring('fixture_stream');
    f.ports.recurring.startClassify=async(...args)=>{f.writes.push(args);return {...receipt(args[0],'recurring_classify'),status:'revision_conflict'};};await c.classify('first','excluded');
    f.ports.recurring.readDetail=async()=>({...detail,stream:{...detail.stream,revision:8}});f.ports.session.readOperations=async()=>[{...receipt('other','review'),status:'reconciliation_required'}];
    await c.loadDetail(false,{recoverConflict:true});expect(c.mutation.current()).toEqual({blocked:true,status:'reconciliation_required'});await c.classify('forbidden','bill');expect(f.writes).toEqual([['first','fixture_stream',4,'excluded']]);c.dispose();
  });
  it('sends the displayed alert revision and only the supplied bounded link action',async()=>{
    const f=fixture(),c=new DetailsController(f.ports);await c.start();await c.resolve('review',alert,'link');
    expect(f.writes).toEqual([['review','review',{eventId:alert.eventId,expectedRevision:7,decision:'link',targetId:'target_tx',candidateTransactionId:'candidate_tx',relation:'confirms',allocatedMoney:null}]]);c.dispose();
  });
  it('rejects unsupported review decisions, resolved rows and unsupported link relations',async()=>{
    const f=fixture(),c=new DetailsController(f.ports);await c.start();
    await c.resolve('a',{...alert,state:'voided'},'ignore');await c.resolve('b',alert,'classify');await c.resolve('c',{...alert,linkAction:{...alert.linkAction!,relation:'possible_duplicate'}},'link');
    expect(f.writes).toEqual([]);expect(reviewDisabledReason({...alert,linkAction:null},'link')).toBeTruthy();c.dispose();
  });
  it('uses transaction annotation revision separately from alert revision and preserves conflicts',async()=>{
    const f=fixture(),c=new DetailsController(f.ports);await c.start();
    f.ports.review.startAnnotate=async(...args)=>{f.writes.push(args);return {...receipt(args[0],'annotate'),status:'revision_conflict'};};
    await c.annotate('note',alert,{category:' Food ',note:'Keep draft'});await c.annotate('again',alert,{category:'Food',note:'Keep draft'});
    expect(f.writes).toEqual([['note',{transactionId:'target_tx',expectedRevision:3,category:'Food',note:'Keep draft'}]]);expect(c.mutation.current().status).toBe('revision_conflict');c.dispose();
  });
  it('keeps highest alert revisions on refresh while honoring new membership/order',async()=>{
    const f=fixture(),c=new DetailsController(f.ports);await c.start();
    f.ports.review.readAlerts=async()=>({items:[{...alert,revision:2},{...alert,eventId:'second',revision:1}],nextCursor:null,limit:50});await c.loadReview();
    expect(c.review.current().data?.items.map(a=>[a.eventId,a.revision])).toEqual([[alert.eventId,7],['second',1]]);
    f.ports.review.readAlerts=async()=>({items:[],nextCursor:null,limit:50});await c.loadReview();expect(c.review.current().data?.items).toEqual([]);c.dispose();
  });
  it('recovers every receipt page and blocks new finance writes for unresolved bank or review work',async()=>{
    const gate=new MutationGate();await gate.recover(async offset=>offset===0?Array.from({length:100},(_,i)=>receipt(String(i),'review')):[{...receipt('pending','plaid'),status:'awaiting_result'}]);
    expect(gate.current()).toEqual({blocked:true,status:'reconciliation_required'});
    const f=fixture();f.ports.session.readOperations=async()=>[{...receipt('pending','review'),status:'submitted'}];const c=new DetailsController(f.ports);await c.start();await c.resolve('new',alert,'ignore');expect(f.writes).toEqual([]);c.dispose();
  });
  it('does not replay a lost Plaid promise or infer its receipt from a success event',async()=>{
    const f=fixture(),c=new DetailsController(f.ports);await c.start();let queries=0;
    f.ports.accounts.startConnect=async(...args)=>{f.writes.push(args);throw new Error('lost');};f.ports.session.queryOperation=async()=>{queries++;return null;};
    await c.connect('plaid');f.emit({...link,state:'pending',outcomeCode:'success',pendingConnectionId:'pending_1',accounts:[account]});await c.selectAccounts('select',['account_1']);
    expect(f.writes).toEqual([['plaid',null]]);expect(queries).toBe(1);expect(c.mutation.current().blocked).toBe(true);c.dispose();
  });
  it.each(['canceled','failed','unsupported'])('shows native Plaid %s outcome and allows a deliberate new flow only after terminal receipt',async outcome=>{
    const f=fixture(),c=new DetailsController(f.ports);await c.start();
    f.ports.accounts.startConnect=async op=>{f.writes.push(op);f.emit({...link,state:outcome,outcomeCode:outcome});return {...receipt(op,'plaid'),status:'canceled'};};
    await c.connect('first');expect(c.accounts.current().data?.link.outcomeCode).toBe(outcome);await c.connect('second');expect(f.writes).toEqual(['first','second']);c.dispose();
  });
  it('confirms only explicitly selected provider accounts, cancels pending and requires disconnect confirmation',async()=>{
    const f=fixture(),c=new DetailsController(f.ports);await c.start();f.emit({...link,state:'pending',outcomeCode:'success',pendingConnectionId:'pending_1',accounts:[account]});
    await c.selectAccounts('bad',['foreign']);await c.selectAccounts('empty',[]);expect(f.writes).toEqual([]);
    await c.selectAccounts('selected',['account_1','account_1']);await c.cancelPending('cancel');await c.disconnect('bad','connection_1',false);await c.disconnect('disconnect','connection_1',true);await c.sync('sync');
    expect(f.writes).toEqual([['select_accounts','selected','pending_1',['account_1']],['cancel_pending','cancel','pending_1'],['disconnect','disconnect','connection_1'],['bank_sync','sync']]);c.dispose();
  });
  it('does not let a stale link snapshot overwrite a callback event',async()=>{
    const f=fixture(),c=new DetailsController(f.ports);let finish!:(v:LinkSnapshot)=>void;f.ports.accounts.getSnapshot=()=>new Promise(resolve=>{finish=resolve;});
    const start=c.start();f.emit({...link,state:'pending',outcomeCode:'success',pendingConnectionId:'pending_new',accounts:[account]});finish(link);await start;
    expect(c.accounts.current().data?.link.pendingConnectionId).toBe('pending_new');c.dispose();
  });
  it('does not let an older full bank refresh change the pending identity used for selection',async()=>{
    const f=fixture(),c=new DetailsController(f.ports);let finish!:(v:LinkSnapshot)=>void;f.ports.accounts.getSnapshot=()=>new Promise(resolve=>{finish=resolve;});
    const start=c.start();f.ports.accounts.getSnapshot=async()=>({...link,state:'pending',outcomeCode:'success',pendingConnectionId:'new_pending',accounts:[account]});await c.loadAccounts();finish(link);await start;
    await c.selectAccounts('selected',['account_1']);expect(f.writes).toEqual([['select_accounts','selected','new_pending',['account_1']]]);c.dispose();
  });
  it('locks all protected data and actions after authorization fails, fencing late reads/events',async()=>{
    const f=fixture(),c=new DetailsController(f.ports);await c.start();await c.openRecurring('fixture_stream');
    let finish!:(v:any)=>void;f.ports.accounts.readAccounts=()=>new Promise(resolve=>{finish=resolve;});const pending=c.loadAccounts();
    f.ports.review.readAlerts=async()=>{throw {code:'unauthorized'};};await c.loadReview();finish({accounts:[account],nextCursor:null,limit:50});await pending;
    f.emit({...link,state:'pending',accounts:[account]});await c.connect('forbidden');await c.classify('forbidden','excluded');await c.resolve('forbidden',alert,'ignore');
    expect(c.review.current()).toMatchObject({phase:'locked',data:null});expect(c.accounts.current()).toMatchObject({phase:'locked',data:null});expect(c.detail.current().data).toBeNull();expect(f.writes).toEqual([]);c.dispose();expect(f.removed()).toBe(3);
  });
});
