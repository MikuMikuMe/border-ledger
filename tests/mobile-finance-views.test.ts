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
    expect(text(tree)).toContain('Spending over time');expect(text(tree)).toContain('2026-10-16');
    expect(text(tree)).toContain('purchase_date');expect(text(tree)).toContain('Excluded');
    const week=tree.root.findAll((n:any)=>n.type==='Pressable'&&n.props.accessibilityLabel==='Report window: Week')[0];
    expect(week.props.accessibilityRole).toBe('radio');expect(week.props.style.minHeight).toBeGreaterThanOrEqual(48);
    expect(tree.root.findAll((n:any)=>n.type==='Pressable'&&n.props.accessibilityLabel==='Reporting currency: KWD').length).toBe(1);
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
    expect(text(tree)).toContain('Expected yearly');expect(text(tree)).toContain('Actual posted cost');expect(text(tree)).toContain('Limited coverage');
    act(()=>tree.root.findAll((n:any)=>n.type==='Pressable'&&n.props.accessibilityLabel?.startsWith('Open recurring'))[0].props.onPress());expect(id).toBe('fixture_stream');
  });
});
