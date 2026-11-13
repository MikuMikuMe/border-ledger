import {createRequire} from 'node:module';
import {describe,expect,it,vi} from 'vitest';
const require=createRequire(new URL('../mobile/package.json',import.meta.url));
const React=require('react');
const {create,act}=require('react-test-renderer');
const pickDate=vi.hoisted(()=>vi.fn());
const confirmDiscard=vi.hoisted(()=>vi.fn());
vi.mock('../mobile/node_modules/react-native/index.js',()=>({NativeModules:{NativeDatePicker:{pick:pickDate}},Alert:{alert:confirmDiscard},Text:'Text',View:'View',Pressable:'Pressable',TextInput:'TextInput',ActivityIndicator:'ActivityIndicator',Modal:'Modal',KeyboardAvoidingView:'KeyboardAvoidingView',ScrollView:'ScrollView',AccessibilityInfo:{setAccessibilityFocus:()=>{}},findNodeHandle:()=>null,StyleSheet:{create:(v:unknown)=>v}}));
// Runtime import keeps RN ambient declarations out of the independent React 18 web typecheck.
const viewModule='../mobile/src/features/finance/FinanceViews';
const {OverviewView,ActivityView,RecurringView}=await import(viewModule);
const {ManualEntryForm}=await import('../mobile/src/features/finance/ManualEntryForm');
const {PlanEditor}=await import('../mobile/src/features/finance/PlanEditor');
const motion=await import('../mobile/src/features/auth/presentationPolicy');
import {report,transaction,stream,states} from './fixtures/mobile-finance';

(globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
const render=(Component:unknown,props:unknown)=>{let tree:any;act(()=>{tree=create(React.createElement(Component,props));});return tree;};
const text=(tree:any)=>JSON.stringify(tree.toJSON());
const ready=(data:unknown)=>({phase:'ready',message:null,data});
const actions={onRetry:()=>{},onLens:()=>{},onFilter:()=>{},onOpen:()=>{},onLoadMore:()=>{},onClose:()=>{},onSave:()=>{},onDraft:()=>{}};
describe('native financial view fixtures and accessibility',()=>{
  it('distinguishes CNY spending bars with the ledger currency color',()=>{
    const cnyReport={...report,dailyTotals:[{date:'2026-10-17',currency:'CNY',confirmedMinorUnits:'2000',provisionalMinorUnits:'0'}]};
    const tree=render(OverviewView,{...actions,dark:false,state:ready(cnyReport),snapshot:null,lens:{window:'Month',source:null,target:null,include:false},currencies:['CAD','CNY']});
    const bar=tree.root.findAll((node:any)=>node.type==='Pressable'&&node.props.accessibilityLabel?.includes(', CNY,'))[0];
    expect(bar.findByType('View').props.style[1].backgroundColor).toBe('#B04E36');
    act(()=>tree.unmount());
  });
  it('gives the report filters immediate Android touch feedback in both themes',()=>{
    for(const dark of [false,true]){
      const tree=render(OverviewView,{...actions,dark,state:ready(report),snapshot:null,lens:{window:'Month',source:null,target:null,include:false},currencies:['CAD','CNY']});
      expect(tree.root.findByProps({accessibilityLabel:'Report filters'}).props.android_ripple?.color).toBeTruthy();
      act(()=>tree.unmount());
    }
  });
  it('dismisses an unchanged Activity detail on backdrop press and confirms a dirty draft',()=>{
    const onClose=vi.fn();
    const props={...actions,onClose,dark:false,state:ready({items:[transaction],nextCursor:null,limit:50}),filters:{},selected:transaction,draft:{category:transaction.category??'',note:transaction.note??''},mutation:{blocked:false,status:'ready'}};
    const tree=render(ActivityView,props);
    act(()=>tree.root.findByProps({accessibilityLabel:'Dismiss Activity detail'}).props.onPress());
    expect(onClose).toHaveBeenCalledTimes(1);
    act(()=>tree.update(React.createElement(ActivityView,{...props,draft:{category:'Changed',note:''}})));
    act(()=>tree.root.findByProps({accessibilityLabel:'Dismiss Activity detail'}).props.onPress());
    expect(onClose).toHaveBeenCalledTimes(1);expect(confirmDiscard).toHaveBeenCalled();
  });
  it('uses the same guarded close for Back and preserves a draft while saving',()=>{
    confirmDiscard.mockClear();const onClose=vi.fn();
    const props={...actions,onClose,dark:false,state:ready({items:[transaction],nextCursor:null,limit:50}),filters:{},selected:transaction,draft:{category:'Changed',note:''},mutation:{blocked:false,status:'ready'}};
    const tree=render(ActivityView,props);
    act(()=>tree.root.findAllByType('Modal')[0].props.onRequestClose());
    expect(confirmDiscard).toHaveBeenCalledTimes(1);expect(onClose).not.toHaveBeenCalled();
    act(()=>confirmDiscard.mock.calls[0][2][1].onPress());expect(onClose).toHaveBeenCalledTimes(1);
    act(()=>tree.update(React.createElement(ActivityView,{...props,mutation:{blocked:true,status:'saving'}})));
    act(()=>tree.root.findAllByType('Modal')[0].props.onRequestClose());expect(confirmDiscard).toHaveBeenCalledTimes(1);
    expect(tree.root.findByProps({accessibilityLabel:'Category'}).props.editable).toBe(false);
    expect(tree.root.findByProps({accessibilityLabel:'Note'}).props.editable).toBe(false);
  });
  it('does not claim an uncertain Activity save was unsuccessful',()=>{
    confirmDiscard.mockClear();
    const props={...actions,dark:false,state:ready({items:[transaction],nextCursor:null,limit:50}),filters:{},selected:transaction,draft:{category:'Changed',note:''},mutation:{blocked:true,status:'reconciliation_required'}};
    const tree=render(ActivityView,props);
    act(()=>tree.root.findByProps({accessibilityLabel:'Dismiss Activity detail'}).props.onPress());
    expect(confirmDiscard.mock.calls[0][1]).not.toContain('have not been saved');
  });
  it('protects a changed recurring plan from outside dismissal',()=>{
    confirmDiscard.mockClear();const onClose=vi.fn();
    const draft={accountId:'a',currency:'CAD',merchant:'',amount:'',direction:'expense',frequency:'monthly',startDate:'2026-11-01',endDate:null,enabled:true};
    const props={dark:false,draft,accounts:[],editing:false,busy:false,onChange:()=>{},onSave:()=>{},onClose};
    const tree=render(PlanEditor,props);
    act(()=>tree.update(React.createElement(PlanEditor,{...props,draft:{...draft,merchant:'Coffee'}})));
    act(()=>tree.root.findByProps({accessibilityLabel:'Dismiss Add recurring plan'}).props.onPress());
    expect(confirmDiscard).toHaveBeenCalledTimes(1);expect(onClose).not.toHaveBeenCalled();
    act(()=>tree.update(React.createElement(PlanEditor,{...props,saving:true,draft:{...draft,merchant:'Coffee'}})));
    act(()=>tree.root.findByProps({accessibilityLabel:'Dismiss Add recurring plan'}).props.onPress());
    expect(confirmDiscard).toHaveBeenCalledTimes(1);expect(onClose).not.toHaveBeenCalled();
  });
  it('labels manual fields and lets a transfer specify its direction',()=>{
    let draft={accountId:'account',date:'2026-11-07',merchant:'Coffee',amount:'12.34',currency:'CAD',kind:'transfer',direction:'out',category:'Food',note:''};
    const account={id:'account',displayName:'Chequing',institution:'Bank',instrument:null,currencies:['CAD','USD'],lastSuccessfulSyncAt:null};
    const props=()=>({dark:false,accounts:[account],draft,onDraft:(value:typeof draft)=>{draft=value;},mutation:{blocked:false,status:'ready'},onSave:()=>{},onClose:()=>{}});
    const tree=render(ManualEntryForm,props());
    expect(tree.root.findByProps({accessibilityLabel:'Description'})).toBeTruthy();
    expect(tree.root.findByProps({accessibilityLabel:'Amount'}).props.keyboardType).toBe('decimal-pad');
    act(()=>tree.root.findByProps({accessibilityLabel:'Into account'}).props.onPress());
    expect(draft.direction).toBe('in');
    act(()=>tree.update(React.createElement(ManualEntryForm,props())));
    expect(tree.root.findByProps({accessibilityLabel:'Into account'}).props.accessibilityState.selected).toBe(true);
    act(()=>tree.update(React.createElement(ManualEntryForm,{...props(),mutation:{blocked:true,status:'reconciliation_required'}})));
    expect(tree.root.findByProps({accessibilityLabel:'Description'}).props.editable).toBe(false);
    expect(tree.root.findByProps({accessibilityLabel:'Close'}).props.accessibilityState.disabled).toBe(false);
  });
  it('confirms before dismissing a changed manual transaction',()=>{
    confirmDiscard.mockClear();const onClose=vi.fn();
    const initial={accountId:'account',date:'2026-11-07',merchant:'',amount:'',currency:'CAD',kind:'expense',direction:'out',category:'',note:''};
    const account={id:'account',displayName:'Chequing',institution:'Bank',instrument:null,currencies:['CAD'],lastSuccessfulSyncAt:null};
    const props={dark:false,accounts:[account],draft:initial,onDraft:()=>{},mutation:{blocked:false,status:'ready'},onSave:()=>{},onClose};
    const tree=render(ManualEntryForm,props);
    act(()=>tree.update(React.createElement(ManualEntryForm,{...props,draft:{...initial,merchant:'Coffee'}})));
    act(()=>tree.root.findByProps({accessibilityLabel:'Dismiss Add transaction'}).props.onPress());
    expect(confirmDiscard).toHaveBeenCalled();expect(onClose).not.toHaveBeenCalled();
  });
  it('offers quick currencies and searches additional supported currencies',()=>{
    let draft={accountId:'account',date:'2026-11-07',merchant:'Coffee',amount:'12',currency:'CNY',kind:'expense',direction:'out',category:'Food',note:''};
    const account={id:'account',displayName:'BOC',institution:'Bank',instrument:null,currencies:['CNY'],lastSuccessfulSyncAt:null};
    const props=()=>({dark:false,accounts:[account],draft,onDraft:(value:typeof draft)=>{draft=value;},mutation:{blocked:false,status:'ready'},onSave:()=>{},onClose:()=>{}});
    const tree=render(ManualEntryForm,props());
    expect(tree.root.findByProps({accessibilityLabel:'USD'})).toBeTruthy();
    act(()=>tree.root.findByProps({accessibilityLabel:'More currencies'}).props.onPress());
    act(()=>tree.root.findByProps({accessibilityLabel:'Search currencies'}).props.onChangeText('euro'));
    act(()=>tree.root.findByProps({accessibilityLabel:'EUR'}).props.onPress());
    expect(draft.currency).toBe('EUR');
    act(()=>tree.update(React.createElement(ManualEntryForm,props())));
    expect(tree.root.findByProps({accessibilityLabel:'EUR'}).props.accessibilityState.selected).toBe(true);
  });
  it('keeps the selection on picker cancellation and defaults when changing accounts',()=>{
    let draft={accountId:'boc',date:'2026-11-07',merchant:'Coffee',amount:'1.01',currency:'CNY',kind:'expense',direction:'out',category:'Food',note:''};
    const accounts=[{id:'boc',displayName:'BOC',institution:'Bank',instrument:null,currencies:['CNY'],lastSuccessfulSyncAt:null},{id:'rbc',displayName:'RBC',institution:'Bank',instrument:null,currencies:['CAD'],lastSuccessfulSyncAt:null}];
    const save=vi.fn(),props=()=>({dark:false,accounts,draft,onDraft:(value:typeof draft)=>{draft=value;},mutation:{blocked:false,status:'ready'},onSave:save,onClose:()=>{}});
    const tree=render(ManualEntryForm,props());
    act(()=>tree.root.findByProps({accessibilityLabel:'More currencies'}).props.onPress());
    act(()=>tree.root.findByProps({accessibilityLabel:'Hide currencies'}).props.onPress());
    expect(draft.currency).toBe('CNY');
    act(()=>tree.root.findByProps({accessibilityLabel:'JPY'}).props.onPress());
    act(()=>tree.update(React.createElement(ManualEntryForm,props())));
    act(()=>tree.root.findByProps({accessibilityLabel:'Save transaction'}).props.onPress());
    expect(save).not.toHaveBeenCalled();
    act(()=>tree.root.findByProps({accessibilityLabel:'Bank RBC'}).props.onPress());
    expect(draft.currency).toBe('CAD');
  });
  it('prevents invalid currency precision from being submitted',()=>{
    const onSave=vi.fn();
    const draft={accountId:'account',date:'2026-11-07',merchant:'Coffee',amount:'1.001',currency:'CAD',kind:'expense',direction:'out',category:'Food',note:''};
    const account={id:'account',displayName:'Chequing',institution:'Bank',instrument:null,currencies:['CAD'],lastSuccessfulSyncAt:null};
    const tree=render(ManualEntryForm,{dark:false,accounts:[account],draft,onDraft:()=>{},mutation:{blocked:false,status:'ready'},onSave,onClose:()=>{}});
    act(()=>tree.root.findByProps({accessibilityLabel:'Save transaction'}).props.onPress());
    expect(onSave).not.toHaveBeenCalled();expect(text(tree)).toContain('correct decimal places');
  });
  it('keeps independent Activity facets available across selection, loading and reset',()=>{
    const cny={...transaction,id:'cny',currency:'CNY',category:'Travel',status:'provisional',sourceLabel:'capture'};
    const facetRows=[transaction,cny];let filters:any={};
    const props=(state:unknown)=>({...actions,dark:false,state,filters,facetRows,selected:null,onFilter:(value:unknown)=>{filters=value;}});
    const tree=render(ActivityView,props(ready({items:facetRows,nextCursor:null,limit:50})));
    act(()=>tree.root.findAll((n:any)=>n.type==='Pressable'&&n.props.accessibilityLabel==='Activity filters')[0].props.onPress());
    const labels=()=>tree.root.findAll((n:any)=>n.type==='Pressable').map((n:any)=>n.props.accessibilityLabel);
    act(()=>tree.root.findAll((n:any)=>n.type==='Pressable'&&n.props.accessibilityLabel==='Currency: CAD')[0].props.onPress());
    act(()=>tree.update(React.createElement(ActivityView,props({phase:'loading',data:null,message:null}))));
    expect(labels()).toEqual(expect.arrayContaining(['Currency: CAD','Currency: CNY','Category: Travel','State: provisional','Source: capture']));
    act(()=>tree.update(React.createElement(ActivityView,props(ready({items:[transaction],nextCursor:null,limit:50})))));
    expect(labels()).toContain('Currency: CNY');
    act(()=>tree.root.findAll((n:any)=>n.type==='Pressable'&&n.props.accessibilityLabel==='Currency: CNY')[0].props.onPress());
    expect(filters.currency).toBe('CNY');
    act(()=>tree.root.findAll((n:any)=>n.type==='Pressable'&&n.props.accessibilityLabel==='Currency: All')[0].props.onPress());
    act(()=>tree.update(React.createElement(ActivityView,props(ready({items:[],nextCursor:null,limit:50})))));
    expect(filters.currency).toBeNull();expect(labels()).toContain('Currency: CAD');expect(labels()).toContain('Currency: CNY');
    act(()=>tree.root.findByProps({accessibilityLabel:'Dismiss Activity filters'}).props.onPress());
    expect(labels()).not.toContain('Currency: CNY');
  });
  it.each(['loading','offline','error','locked'])('renders %s with a labeled retry and live status',phase=>{
    const tree=render(ActivityView,{...actions,dark:false,state:{phase,data:null,message:phase==='loading'?null:'Recoverable fixture status'},filters:{},selected:null});
    expect(text(tree)).toContain(phase==='loading'?'Loading':'Recoverable fixture status');
    expect(tree.root.findAll((n:any)=>n.props.accessibilityLiveRegion==='polite').length).toBeGreaterThan(0);
    expect(tree.root.findAll((n:any)=>n.type==='Pressable'&&n.props.accessibilityLabel==='Refresh Activity').length).toBe(1);
  });
  it('renders full-window report totals, signed chart/table alternative and FX coverage',()=>{
    const tree=render(OverviewView,{...actions,dark:true,state:ready(report),snapshot:null,lens:{window:'Month',include:false,source:null,target:null},currencies:['CAD','CNY']});
    expect(text(tree)).toContain('Spending over time');
    expect(tree.root.findAll((n:any)=>n.props.accessible&&n.props.accessibilityLabel?.includes('confirmed')).length).toBe(0);
    act(()=>tree.root.findAll((n:any)=>n.type==='Pressable'&&n.props.accessibilityLabel==='Daily breakdown')[0].props.onPress());
    expect(tree.root.findAll((n:any)=>n.props.accessible&&n.props.accessibilityLabel?.includes('confirmed')).length).toBeGreaterThan(0);
    act(()=>tree.root.findAll((n:any)=>n.type==='Pressable'&&n.props.accessibilityLabel==='Report details')[0].props.onPress());
    expect(text(tree)).toContain('purchase_date');expect(text(tree)).toContain('Excluded');
    const week=tree.root.findAll((n:any)=>n.type==='Pressable'&&n.props.accessibilityLabel==='Report window: Week')[0];
    expect(week.props.accessibilityRole).toBe('radio');expect(week.props.style.minHeight).toBeGreaterThanOrEqual(48);
  });
  it('applies a custom range only after valid dates are entered',()=>{
    const onLens=vi.fn();
    const tree=render(OverviewView,{...actions,onLens,dark:false,state:ready(report),snapshot:null,lens:{window:'Month',include:false,source:null,target:null},currencies:['CAD']});
    act(()=>tree.root.findByProps({accessibilityLabel:'Report window: Custom'}).props.onPress());
    const start=tree.root.findByProps({accessibilityLabel:'Start date (YYYY-MM-DD)'});
    const end=tree.root.findByProps({accessibilityLabel:'End date (YYYY-MM-DD)'});
    act(()=>{start.props.onChangeText('2026-02-30');end.props.onChangeText('2026-03-01');});
    expect(tree.root.findByProps({accessibilityLabel:'Apply range'}).props.disabled).toBe(true);
    act(()=>start.props.onChangeText('2026-02-28'));
    act(()=>tree.root.findByProps({accessibilityLabel:'Apply range'}).props.onPress());
    expect(onLens).toHaveBeenCalledWith(expect.objectContaining({window:'Custom',startDate:'2026-02-28',endDate:'2026-03-01'}));
  });
  it('asks before discarding an edited custom date range',()=>{
    confirmDiscard.mockClear();
    const tree=render(OverviewView,{...actions,dark:false,state:ready(report),snapshot:null,lens:{window:'Month',include:false,source:null,target:null},currencies:['CAD']});
    act(()=>tree.root.findByProps({accessibilityLabel:'Report window: Custom'}).props.onPress());
    act(()=>tree.root.findByProps({accessibilityLabel:'Start date (YYYY-MM-DD)'}).props.onChangeText('2026-09-01'));
    act(()=>tree.root.findByProps({accessibilityLabel:'Dismiss Custom date range'}).props.onPress());
    expect(confirmDiscard).toHaveBeenCalledTimes(1);
    expect(tree.root.findByProps({accessibilityLabel:'Start date (YYYY-MM-DD)'}).props.value).toBe('2026-09-01');
  });
  it('lets the user pick a start date while keeping typed input available',async()=>{
    pickDate.mockResolvedValueOnce('2026-09-15');
    const tree=render(OverviewView,{...actions,dark:false,state:ready(report),snapshot:null,lens:{window:'Month',include:false,source:null,target:null},currencies:['CAD']});
    act(()=>tree.root.findByProps({accessibilityLabel:'Report window: Custom'}).props.onPress());
    await act(async()=>{tree.root.findByProps({accessibilityLabel:'Choose start date'}).props.onPress();});
    expect(pickDate).toHaveBeenCalledWith('2026-10-01');
    expect(tree.root.findByProps({accessibilityLabel:'Start date (YYYY-MM-DD)'}).props.value).toBe('2026-09-15');
  });
  it('keeps the typed date when the calendar is canceled or unavailable',async()=>{
    pickDate.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('unavailable'));
    const tree=render(OverviewView,{...actions,dark:false,state:ready(report),snapshot:null,lens:{window:'Month',include:false,source:null,target:null},currencies:['CAD']});
    act(()=>tree.root.findByProps({accessibilityLabel:'Report window: Custom'}).props.onPress());
    await act(async()=>{tree.root.findByProps({accessibilityLabel:'Choose end date'}).props.onPress();});
    expect(tree.root.findByProps({accessibilityLabel:'End date (YYYY-MM-DD)'}).props.value).toBe('2026-10-17');
    await act(async()=>{tree.root.findByProps({accessibilityLabel:'Choose end date'}).props.onPress();});
    expect(text(tree)).toContain('Could not open the calendar');
    expect(tree.root.findByProps({accessibilityLabel:'End date (YYYY-MM-DD)'}).props.value).toBe('2026-10-17');
  });
  it('reveals reporting currencies in report filters',()=>{
    const tree=render(OverviewView,{...actions,dark:true,state:ready(report),snapshot:null,lens:{window:'Month',include:false,source:null,target:null},currencies:['CAD','CNY']});
    expect(tree.root.findAll((n:any)=>n.type==='Pressable'&&n.props.accessibilityLabel==='Reporting currency: KWD')).toHaveLength(0);
    act(()=>tree.root.findAll((n:any)=>n.type==='Pressable'&&n.props.accessibilityLabel==='Report filters')[0].props.onPress());
    expect(tree.root.findAll((n:any)=>n.type==='Modal')).toHaveLength(1);
    expect(tree.root.findByType('Modal').props.animationType).toBe('slide');
    expect(tree.root.findByType('Modal').findByType('KeyboardAvoidingView').props.behavior).toBe('padding');
    expect(tree.root.findAll((n:any)=>n.type==='Pressable'&&n.props.accessibilityLabel==='Reporting currency: No conversion')).toHaveLength(1);
    expect(tree.root.findAll((n:any)=>n.type==='ScrollView'&&n.props.accessibilityLabel==='Reporting currency options'&&n.props.keyboardShouldPersistTaps==='handled')).toHaveLength(1);
    const search=tree.root.findAll((n:any)=>n.type==='TextInput'&&n.props.accessibilityLabel==='Search reporting currency')[0];
    act(()=>search.props.onChangeText('KWD'));
    expect(tree.root.findAll((n:any)=>n.type==='Pressable'&&n.props.accessibilityLabel==='Reporting currency: KWD')).toHaveLength(1);
    act(()=>tree.root.findByType('Modal').props.onRequestClose());
    expect(tree.root.findAll((n:any)=>n.type==='Modal')).toHaveLength(0);
  });
  it('keeps the prior-period comparison concise and its coverage context in details',()=>{
    const tree=render(OverviewView,{...actions,dark:false,state:ready(report),previous:ready({...report,from:'2026-09-14',to:'2026-09-30'}),snapshot:null,lens:{window:'Month',include:false,source:null,target:null},currencies:['CAD']});
    expect(text(tree)).toContain('Previous period');expect(text(tree)).not.toContain('recorded spending');expect(text(tree)).not.toContain('Account coverage may differ');
    act(()=>tree.root.findAll((n:any)=>n.type==='Pressable'&&n.props.accessibilityLabel==='Report details')[0].props.onPress());
    expect(text(tree)).toContain('Account coverage may differ');
  });
  it('removes filter panel motion when reduced motion is enabled',()=>{
    const {ReducedMotionContext}=motion;
    const props={...actions,dark:false,state:ready(report),snapshot:null,lens:{window:'Month',include:false,source:null,target:null},currencies:['CAD']};
    let tree:any;act(()=>{tree=create(React.createElement(ReducedMotionContext.Provider,{value:true},React.createElement(OverviewView,props)));});
    act(()=>tree.root.findByProps({accessibilityLabel:'Report filters'}).props.onPress());
    expect(tree.root.findByType('Modal').props.animationType).toBe('none');
  });
  it('prioritizes spending while keeping report context and refresh accessible',()=>{
    const tree=render(OverviewView,{...actions,dark:true,state:ready(report),snapshot:null,lens:{window:'Month',include:false,source:null,target:null},currencies:['CAD','CNY']});
    expect(text(tree)).not.toContain('purchase_date');expect(text(tree)).not.toContain('America/Toronto');
    expect(tree.root.findAll((n:any)=>n.type==='Pressable'&&n.props.accessibilityLabel==='Refresh report')).toHaveLength(1);
    expect(tree.root.findAll((n:any)=>n.type==='Text'&&n.props.accessibilityRole==='header'&&n.children.join('')==='Net spending this month')).toHaveLength(1);
    act(()=>tree.root.findAll((n:any)=>n.type==='Pressable'&&n.props.accessibilityLabel==='Report details')[0].props.onPress());
    expect(text(tree)).toContain('purchase_date');expect(text(tree)).toContain('America/Toronto');
  });
  it('selects a chart day and exposes the highest positive day',()=>{
    const tree=render(OverviewView,{...actions,dark:false,state:ready(report),snapshot:null,lens:{window:'Month',include:false,source:null,target:null},currencies:['CAD']});
    expect(text(tree)).toContain('Highest day');
    const day=tree.root.findAll((n:any)=>n.type==='Pressable'&&n.props.accessibilityLabel?.includes('Oct 16, 2026'))[0];
    expect(day.props.accessibilityRole).toBe('button');act(()=>day.props.onPress());
    expect(text(tree)).toContain('Selected day');expect(day.props.accessibilityState.selected).toBe(true);
  });
  it('repositions the same peak when the reporting window changes',()=>{
    const scrollTo=vi.fn();const props={...actions,dark:false,state:ready(report),snapshot:null,lens:{window:'Month',include:false,source:null,target:null},currencies:['CAD']};
    let tree:any;act(()=>{tree=create(React.createElement(OverviewView,props),{createNodeMock:(node:any)=>node.type==='ScrollView'?{scrollTo}:null});});
    expect(scrollTo).toHaveBeenLastCalledWith({x:672,animated:false});
    act(()=>tree.update(React.createElement(OverviewView,{...props,state:ready({...report,from:'2026-10-15'})})));
    expect(scrollTo).toHaveBeenLastCalledWith({x:0,animated:false});
  });
  it('explains unavailable prior reports and does not call a refund-only default a selected day',()=>{
    const negative={...report,from:'2026-10-16',to:'2026-10-16',dailyTotals:[report.dailyTotals[1]]};
    const tree=render(OverviewView,{...actions,dark:false,state:ready(negative),previous:{phase:'offline',data:null,message:'Offline'},snapshot:null,lens:{window:'Month',include:false,source:null,target:null},currencies:['CAD']});
    expect(text(tree)).toContain('First day');expect(text(tree)).toContain('Previous period unavailable');
    const bar=tree.root.findAll((n:any)=>n.type==='Pressable'&&n.props.accessibilityLabel?.includes('Oct 16, 2026, CAD'))[0];
    expect(bar.props.accessibilityState.selected).toBe(false);
  });
  it('does not invent zero days when conversion is incomplete',()=>{
    const partial={...report,reportingCurrency:'CAD',convertedDailyTotals:[{date:'2026-10-17',confirmedMinorUnits:'100',provisionalMinorUnits:'0'}]};
    const tree=render(OverviewView,{...actions,dark:false,state:ready(partial),snapshot:null,lens:{window:'Month',include:false,source:null,target:'CAD'},currencies:['CAD']});
    expect(tree.root.findAll((n:any)=>n.type==='Pressable'&&n.props.accessibilityLabel?.includes('Oct 16, 2026, CAD'))).toHaveLength(0);
  });
  it('keeps report filters available when a report cannot load',()=>{
    const tree=render(OverviewView,{...actions,dark:false,state:{phase:'error',data:null,message:'Unavailable'},snapshot:null,lens:{window:'Month',include:false,source:null,target:null},currencies:['CAD']});
    expect(tree.root.findAll((n:any)=>n.type==='Pressable'&&n.props.accessibilityLabel==='Report filters')).toHaveLength(1);
  });
  it('shows activity as a single accessible ledger row with its merchant and amount',()=>{
    const tree=render(ActivityView,{...actions,dark:false,state:ready({items:[transaction],nextCursor:null,limit:50}),filters:{},selected:null});
    const row=tree.root.findAll((n:any)=>n.type==='Pressable'&&n.props.accessibilityLabel?.startsWith('Open activity:'))[0];
    expect(row.props.accessibilityRole).toBe('button');expect(row.props.accessibilityLabel).toContain(transaction.status);expect(row.props.accessibilityLabel).toContain(transaction.category);expect(row.props.accessibilityLabel).toContain('Source:');expect(row.props.accessibilityLabel.match(/10\.00/g)).toHaveLength(1);
    const rowText=row.findAll((n:any)=>n.type==='Text').map((n:any)=>n.children.join('')).join(' ');
    expect(row.findAll((n:any)=>n.type==='Text').some((n:any)=>n.children.join('')===transaction.merchant)).toBe(true);expect(rowText).toContain('10.00');expect(rowText).toContain('CAD');
    expect(rowText).not.toContain('Source:');
    expect(rowText).toContain('2026-10-17 12:00:00 UTC');
  });
  it('opens the actual transaction and exposes editable labeled fields with draft preservation',()=>{
    let opened='';let saved:any;
    const tree=render(ActivityView,{...actions,onOpen:(id:string)=>{opened=id;},onSave:()=>{saved=true;},dark:false,state:ready({items:[transaction],nextCursor:'fixture_cursor',limit:50}),filters:{},selected:transaction,draft:{category:'Food',note:'Keep me'},mutation:{blocked:false,status:'revision_conflict'}});
    act(()=>tree.root.findAll((n:any)=>n.type==='Pressable'&&n.props.accessibilityLabel?.startsWith('Open activity'))[0].props.onPress());
    expect(opened).toBe('fixture_tx');
    expect(tree.root.findAll((n:any)=>n.type==='TextInput'&&n.props.accessibilityLabel==='Category')[0].props.value).toBe('Food');
    expect(text(tree)).toContain('Keep me');expect(text(tree)).toContain('changed elsewhere');
    expect(text(tree)).toContain('Changes affect only the category and note.');
    expect(tree.root.findAll((n:any)=>n.type==='Pressable'&&n.props.accessibilityLabel==='Save annotation')[0].props.disabled).toBe(true);
    expect(tree.root.findAll((n:any)=>n.type==='Modal')[0].props.onRequestClose).toBeTypeOf('function');
  });
  it.each(states)('renders recurring %s source state without inventing estimates',state=>{
    const tree=render(RecurringView,{...actions,dark:false,state:ready({page:{items:[],nextCursor:null,limit:50,state,checkedAt:null,sourceUpdatedAt:null,lastError:null,coverageWarnings:[]},summary:null}),filters:{},currencies:['CAD','CNY','JPY']});
    expect(text(tree)).toContain(state==='empty'?'No recurring streams':state==='waiting'?'still being prepared':state==='incomplete'?'incomplete':state==='stale'?'last good':state==='unavailable'?'unavailable':'reported an error');
  });
  it('shows only non-zero recurring summary amounts and explains empty sections',()=>{
    const money=[{currency:'CAD',amountMinor:'0'},{currency:'CNY',amountMinor:'-1250'},{currency:'JPY',amountMinor:'0'}];
    const summary={monthlyByCurrency:money,yearlyByCurrency:money,subscriptionByCurrency:[{currency:'CAD',amountMinor:'0'}],actualCostByCurrency:[{currency:'JPY',amountMinor:'700'},{currency:'CAD',amountMinor:'0'}],upcoming:[],latestPaymentChanges:[],streamCount:1,coverageWarnings:[],checkedAt:null,sourceUpdatedAt:null,lastError:null,state:'ready'};
    const page={items:[],nextCursor:null,limit:50,state:'ready',coverageWarnings:[],checkedAt:null,sourceUpdatedAt:null,lastError:null};
    const tree=render(RecurringView,{...actions,dark:false,state:ready({page,summary}),filters:{},currencies:['CAD','CNY','JPY']});
    const labels=tree.root.findAll((n:any)=>n.type==='Text').map((n:any)=>n.children.join(''));
    expect(labels.filter((v:string)=>v.endsWith(' CNY'))).toHaveLength(2);
    expect(labels.filter((v:string)=>v.endsWith(' JPY'))).toHaveLength(1);
    expect(labels.filter((v:string)=>v.endsWith(' CAD'))).toHaveLength(0);
    expect(labels).toContain('No non-zero totals.');
  });
  it('dismisses recurring selection outside unless a save is running',()=>{
    const onClose=vi.fn(),props={...actions,onClose,dark:false,state:ready({page:null,summary:null}),filters:{},currencies:[],selected:stream,mutation:{blocked:false,status:'ready'}};
    const tree=render(RecurringView,props);
    act(()=>tree.root.findByProps({accessibilityLabel:`Dismiss ${stream.merchantName}`}).props.onPress());expect(onClose).toHaveBeenCalledTimes(1);
    act(()=>tree.update(React.createElement(RecurringView,{...props,mutation:{blocked:true,status:'saving'}})));
    act(()=>tree.root.findByProps({accessibilityLabel:`Dismiss ${stream.merchantName}`}).props.onPress());expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('renders recurring monthly/yearly/subscription/actual separately and opens the stream',()=>{
    let id='';
    const money=[{currency:'CAD',amountMinor:'1000'}];
    const tree=render(RecurringView,{...actions,onOpen:(value:string)=>{id=value;},dark:false,state:ready({page:{items:[stream],nextCursor:'next',limit:50,state:'ready',coverageWarnings:['Limited coverage'],checkedAt:'2026-10-17',sourceUpdatedAt:null,lastError:null},summary:{monthlyByCurrency:money,yearlyByCurrency:[{currency:'CAD',amountMinor:'12000'}],subscriptionByCurrency:money,actualCostByCurrency:[{currency:'CAD',amountMinor:'800'}],upcoming:[{stream,nextExpectedAmountMinor:'1000'}],latestPaymentChanges:[stream],streamCount:1,state:'ready',coverageWarnings:[],checkedAt:'2026-10-17',sourceUpdatedAt:null,lastError:null}}),filters:{},currencies:['CAD']});
    expect(text(tree)).toContain('Expected yearly');expect(text(tree)).toContain('Actual posted cost');expect(tree.root.findAll((n:any)=>n.type==='Text'&&n.props.accessibilityRole==='header'&&n.children.join('')==='Expected yearly')).toHaveLength(1);expect(text(tree)).toContain('Limited coverage');
    act(()=>tree.root.findAll((n:any)=>n.type==='Pressable'&&n.props.accessibilityLabel?.startsWith('Open recurring'))[0].props.onPress());expect(id).toBe('fixture_stream');
  });
});
