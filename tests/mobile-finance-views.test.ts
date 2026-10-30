import {createRequire} from 'node:module';
import {describe,expect,it,vi} from 'vitest';
const require=createRequire(new URL('../mobile/package.json',import.meta.url));
const React=require('react');
const {create,act}=require('react-test-renderer');
vi.mock('../mobile/node_modules/react-native/index.js',()=>({Text:'Text',View:'View',Pressable:'Pressable',TextInput:'TextInput',ActivityIndicator:'ActivityIndicator',Modal:'Modal',KeyboardAvoidingView:'KeyboardAvoidingView',ScrollView:'ScrollView',AccessibilityInfo:{setAccessibilityFocus:()=>{}},findNodeHandle:()=>null,StyleSheet:{create:(v:unknown)=>v}}));
// Runtime import keeps RN ambient declarations out of the independent React 18 web typecheck.
const viewModule='../mobile/src/features/finance/FinanceViews';
const {OverviewView,ActivityView,RecurringView}=await import(viewModule);
import {report,transaction,stream,states} from './fixtures/mobile-finance';

(globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
const render=(Component:unknown,props:unknown)=>{let tree:any;act(()=>{tree=create(React.createElement(Component,props));});return tree;};
const text=(tree:any)=>JSON.stringify(tree.toJSON());
const ready=(data:unknown)=>({phase:'ready',message:null,data});
const actions={onRetry:()=>{},onLens:()=>{},onFilter:()=>{},onOpen:()=>{},onLoadMore:()=>{},onClose:()=>{},onSave:()=>{},onDraft:()=>{}};
describe('native financial view fixtures and accessibility',()=>{
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
  it('reveals reporting currencies in report filters',()=>{
    const tree=render(OverviewView,{...actions,dark:true,state:ready(report),snapshot:null,lens:{window:'Month',include:false,source:null,target:null},currencies:['CAD','CNY']});
    expect(tree.root.findAll((n:any)=>n.type==='Pressable'&&n.props.accessibilityLabel==='Reporting currency: KWD')).toHaveLength(0);
    act(()=>tree.root.findAll((n:any)=>n.type==='Pressable'&&n.props.accessibilityLabel==='Report filters')[0].props.onPress());
    expect(tree.root.findAll((n:any)=>n.type==='Pressable'&&n.props.accessibilityLabel==='Reporting currency: KWD')).toHaveLength(1);
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
  });
  it('opens the actual transaction and exposes editable labeled fields with draft preservation',()=>{
    let opened='';let saved:any;
    const tree=render(ActivityView,{...actions,onOpen:(id:string)=>{opened=id;},onSave:()=>{saved=true;},dark:false,state:ready({items:[transaction],nextCursor:'fixture_cursor',limit:50}),filters:{},selected:transaction,draft:{category:'Food',note:'Keep me'},mutation:{blocked:false,status:'revision_conflict'}});
    act(()=>tree.root.findAll((n:any)=>n.type==='Pressable'&&n.props.accessibilityLabel?.startsWith('Open activity'))[0].props.onPress());
    expect(opened).toBe('fixture_tx');
    expect(tree.root.findAll((n:any)=>n.type==='TextInput'&&n.props.accessibilityLabel==='Category')[0].props.value).toBe('Food');
    expect(text(tree)).toContain('Keep me');expect(text(tree)).toContain('changed elsewhere');
    expect(tree.root.findAll((n:any)=>n.type==='Pressable'&&n.props.accessibilityLabel==='Save annotation')[0].props.disabled).toBe(true);
    expect(tree.root.findAll((n:any)=>n.type==='Modal')[0].props.onRequestClose).toBeTypeOf('function');
  });
  it.each(states)('renders recurring %s source state without inventing estimates',state=>{
    const tree=render(RecurringView,{...actions,dark:false,state:ready({page:{items:[],nextCursor:null,limit:50,state,checkedAt:null,sourceUpdatedAt:null,lastError:null,coverageWarnings:[]},summary:null}),filters:{},currencies:['CAD','CNY','JPY']});
    expect(text(tree)).toContain(state==='empty'?'No recurring streams':state==='waiting'?'still being prepared':state==='incomplete'?'incomplete':state==='stale'?'last good':state==='unavailable'?'unavailable':'reported an error');
  });
  it('renders recurring monthly/yearly/subscription/actual separately and opens the stream',()=>{
    let id='';
    const money=[{currency:'CAD',amountMinor:'1000'}];
    const tree=render(RecurringView,{...actions,onOpen:(value:string)=>{id=value;},dark:false,state:ready({page:{items:[stream],nextCursor:'next',limit:50,state:'ready',coverageWarnings:['Limited coverage'],checkedAt:'2026-10-17',sourceUpdatedAt:null,lastError:null},summary:{monthlyByCurrency:money,yearlyByCurrency:[{currency:'CAD',amountMinor:'12000'}],subscriptionByCurrency:money,actualCostByCurrency:[{currency:'CAD',amountMinor:'800'}],upcoming:[{stream,nextExpectedAmountMinor:'1000'}],latestPaymentChanges:[stream],streamCount:1,state:'ready',coverageWarnings:[],checkedAt:'2026-10-17',sourceUpdatedAt:null,lastError:null}}),filters:{},currencies:['CAD']});
    expect(text(tree)).toContain('Expected yearly');expect(text(tree)).toContain('Actual posted cost');expect(tree.root.findAll((n:any)=>n.type==='Text'&&n.props.accessibilityRole==='header'&&n.children.join('')==='Expected yearly')).toHaveLength(1);expect(text(tree)).toContain('Limited coverage');
    act(()=>tree.root.findAll((n:any)=>n.type==='Pressable'&&n.props.accessibilityLabel?.startsWith('Open recurring'))[0].props.onPress());expect(id).toBe('fixture_stream');
  });
});
