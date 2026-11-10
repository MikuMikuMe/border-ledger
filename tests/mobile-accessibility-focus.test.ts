import {createRequire} from 'node:module';
import {afterEach,describe,expect,it,vi} from 'vitest';
const require=createRequire(new URL('../mobile/package.json',import.meta.url));
const React=require('react'),{act,create}=require('react-test-renderer');
const focus=vi.hoisted(()=>vi.fn());
const nativeFocus=vi.hoisted(()=>vi.fn());
vi.mock('../mobile/node_modules/react-native/index.js',()=>({NativeModules:{NativeAccessibilityFocus:{focus:nativeFocus}},Platform:{OS:'android'},BackHandler:{addEventListener:()=>({remove(){}})},Text:'Text',View:'View',Pressable:'Pressable',TextInput:'TextInput',ActivityIndicator:'ActivityIndicator',Modal:'Modal',KeyboardAvoidingView:'KeyboardAvoidingView',ScrollView:'ScrollView',Alert:{alert:vi.fn()},AccessibilityInfo:{setAccessibilityFocus:focus},findNodeHandle:(node:any)=>node?.tag??null,StyleSheet:{create:(v:unknown)=>v}}));
vi.mock('../mobile/src/features/budget/useMobileBudget',()=>({useMobileBudget:()=>({month:'2026-11',loading:false,error:null,configured:true,view:null,mutation:{blocked:false,status:'ready'},write:()=>{},chooseMonth:()=>{},shiftMonth:()=>{},load:()=>{},selectMode:()=>{}})}));
vi.mock('../mobile/src/features/budget/AnalysisContent',()=>({AnalysisContent:()=>null}));
const {BudgetScreen}=await import('../mobile/src/screens/BudgetScreen');
const {ActivityView,OverviewView}=await import('../mobile/src/features/finance/FinanceViews');
const {useAccessibilityReturnFocus}=await import('../mobile/src/features/finance/accessibilityFocus');
const {TrackingContent}=await import('../mobile/src/features/budget/TrackingContent');
const {ReviewView,AccountsView}=await import('../mobile/src/features/details/DetailsViews');
const {alert,account,connection,link}=await import('./fixtures/mobile-details');
import {transaction,report} from './fixtures/mobile-finance';
(globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
const state={phase:'ready',data:{items:[transaction],nextCursor:null,limit:50},message:null};
const actions={onRetry:()=>{},onFilter:()=>{},onOpen:()=>{},onLoadMore:()=>{},onClose:()=>{},onDraft:()=>{},onSave:()=>{}};
const props={...actions,dark:false,state,filters:{},selected:null as typeof transaction|null,draft:{category:transaction.category??'',note:transaction.note??''},mutation:{blocked:false,status:'ready'}};
afterEach(()=>{vi.useRealTimers();focus.mockClear();nativeFocus.mockClear();});
describe('Android dialog focus restoration',()=>{
 it('returns focus to the selected transaction after its dialog closes',()=>{
  vi.useFakeTimers();let tree:any;
  act(()=>{tree=create(React.createElement(ActivityView,props),{createNodeMock:(element:any)=>({tag:element.props.accessibilityLabel?.startsWith('Open activity:')?42:17})});});
  act(()=>tree.root.findAll((node:any)=>node.type==='Pressable'&&node.props.accessibilityLabel?.startsWith('Open activity:'))[0].props.onPress());
  act(()=>tree.update(React.createElement(ActivityView,{...props,selected:transaction})));
  act(()=>tree.update(React.createElement(ActivityView,props)));
  act(()=>vi.runAllTimers());expect(nativeFocus).toHaveBeenCalledWith(42);act(()=>tree.unmount());
 });
 it('returns focus to the Review row after evidence closes',()=>{
  vi.useFakeTimers();let tree:any;
  const base={...actions,dark:false,state:{phase:'ready',data:{items:[alert],nextCursor:null,limit:50},message:null},selected:null,mutation:{blocked:false,status:'ready'},draft:{category:'Food',note:''},onResolve:()=>{}};
  act(()=>{tree=create(React.createElement(ReviewView,base),{createNodeMock:(element:any)=>({tag:element.props.accessibilityLabel?.startsWith('Review purchase_notice')?44:17})});});
  act(()=>tree.root.findAll((node:any)=>node.type==='Pressable'&&node.props.accessibilityLabel?.startsWith('Review purchase_notice'))[0].props.onPress());
  act(()=>tree.update(React.createElement(ReviewView,{...base,selected:alert})));
  act(()=>tree.update(React.createElement(ReviewView,base)));
  act(()=>vi.runAllTimers());expect(nativeFocus).toHaveBeenCalledWith(44);act(()=>tree.unmount());
 });
 it('returns focus to the account row after details close',()=>{
  vi.useFakeTimers();let tree:any;
  const base={...actions,dark:false,state:{phase:'ready',data:{page:{accounts:[account],nextCursor:null},connections:[connection],link},message:null},mutation:{blocked:false,status:'ready'},onConnect:()=>{},onCancelConnect:()=>{},onSelect:()=>{},onCancel:()=>{},onSync:()=>{},onDisconnect:()=>{}};
  act(()=>{tree=create(React.createElement(AccountsView,base),{createNodeMock:(element:any)=>({tag:element.props.accessibilityLabel?.startsWith('Open account Everyday CAD')?45:17})});});
  act(()=>tree.root.findAll((node:any)=>node.type==='Pressable'&&node.props.accessibilityLabel?.startsWith('Open account Everyday CAD'))[0].props.onPress());
  act(()=>tree.root.findByProps({accessibilityLabel:'Dismiss Account detail'}).props.onPress());
  act(()=>vi.runAllTimers());expect(nativeFocus).toHaveBeenCalledWith(45);act(()=>tree.unmount());
 });
 it('returns focus to the disconnect action when confirmation is canceled',()=>{
  vi.useFakeTimers();let tree:any;
  const base={...actions,dark:false,state:{phase:'ready',data:{page:{accounts:[account],nextCursor:null},connections:[connection],link},message:null},mutation:{blocked:false,status:'ready'},onConnect:()=>{},onCancelConnect:()=>{},onSelect:()=>{},onCancel:()=>{},onSync:()=>{},onDisconnect:()=>{}};
  act(()=>{tree=create(React.createElement(AccountsView,base),{createNodeMock:(element:any)=>({tag:element.props.accessibilityLabel==='Disconnect Fixture Bank'?46:17})});});
  act(()=>tree.root.findByProps({accessibilityLabel:'Disconnect Fixture Bank'}).props.onPress());
  act(()=>tree.root.findByProps({accessibilityLabel:'Keep connection'}).props.onPress());
  act(()=>vi.runAllTimers());expect(nativeFocus).toHaveBeenCalledWith(46);act(()=>tree.unmount());
 });
 it('returns focus to the filter trigger after the sheet closes',()=>{
  vi.useFakeTimers();let tree:any;
  act(()=>{tree=create(React.createElement(ActivityView,props),{createNodeMock:(element:any)=>({tag:element.props.accessibilityLabel==='Activity filters'?55:17})});});
  act(()=>tree.root.findByProps({accessibilityLabel:'Activity filters'}).props.onPress());
  act(()=>tree.root.findByProps({accessibilityLabel:'Dismiss Activity filters'}).props.onPress());
  act(()=>vi.runAllTimers());expect(nativeFocus).toHaveBeenCalledWith(55);act(()=>tree.unmount());
 });
 it('returns focus to the custom date opener after dismissal',()=>{
  vi.useFakeTimers();let tree:any;
  const viewProps={...actions,dark:false,state:{phase:'ready',data:report,message:null},snapshot:null,lens:{window:'Month',include:false,source:null,target:null},currencies:['CAD']};
  act(()=>{tree=create(React.createElement(OverviewView,viewProps),{createNodeMock:(element:any)=>({tag:element.props.accessibilityLabel==='Report window: Custom'?99:17,scrollTo:()=>{}})});});
  act(()=>tree.root.findByProps({accessibilityLabel:'Report window: Custom'}).props.onPress());
  act(()=>tree.root.findByProps({accessibilityLabel:'Dismiss Custom date range'}).props.onPress());
  act(()=>vi.runAllTimers());expect(nativeFocus).toHaveBeenCalledWith(99);act(()=>tree.unmount());
 });
 it('returns focus to the budget month trigger after dismissal',()=>{
  vi.useFakeTimers();let tree:any;
  act(()=>{tree=create(React.createElement(BudgetScreen,{dark:false,showAnalysis:false}),{createNodeMock:(element:any)=>({tag:element.props.accessibilityLabel==='Choose budget month'?101:17})});});
  act(()=>tree.root.findByProps({accessibilityLabel:'Choose budget month'}).props.onPress());
  act(()=>tree.root.findByProps({accessibilityLabel:'Dismiss Choose budget month'}).props.onPress());
  act(()=>vi.runAllTimers());expect(nativeFocus).toHaveBeenCalledWith(101);act(()=>tree.unmount());
 });
 it('returns focus to a budget plan opener after dismissal',()=>{
  vi.useFakeTimers();let tree:any;
  const view={settings:{currency:'CAD',revision:1},summary:{month:'2026-10',plannedIncomeMinor:0,plannedExpenseMinor:10000,plannedSavingsMinor:-10000,actualIncomeMinor:0,actualExpenseMinor:0,actualSavingsMinor:0,categories:[{direction:'expense',category:'Food',plannedMinor:10000,actualMinor:0,varianceMinor:0,missingTransactionIds:[]}]},activity:[]};
  act(()=>{tree=create(React.createElement(TrackingContent,{dark:false,view,busy:false,onWrite:()=>{},onCopy:()=>{}}),{createNodeMock:(element:any)=>({tag:element.props.accessibilityLabel==='Edit expense Food'?66:17})});});
  act(()=>tree.root.findByProps({accessibilityLabel:'Edit expense Food'}).props.onPress());
  act(()=>tree.root.findByProps({accessibilityLabel:'Dismiss Edit Food plan'}).props.onPress());
  act(()=>vi.runAllTimers());expect(nativeFocus).toHaveBeenCalledWith(66);act(()=>tree.unmount());
 });
 it('does not steal focus when a dialog hands off to another screen',()=>{
  vi.useFakeTimers();let tree:any;
  function Handoff(){const [open,setOpen]=React.useState(false),trigger=React.useRef(null),{remember,suppress}=useAccessibilityReturnFocus(open);return React.createElement('View',null,React.createElement('Pressable',{ref:trigger,accessibilityLabel:'Open',onPress:()=>{remember(trigger);setOpen(true);}}),open?React.createElement('Pressable',{accessibilityLabel:'Continue',onPress:()=>{suppress();setOpen(false);}}):null);}
  act(()=>{tree=create(React.createElement(Handoff),{createNodeMock:()=>({tag:77})});});
  act(()=>tree.root.findByProps({accessibilityLabel:'Open'}).props.onPress());
  act(()=>tree.root.findByProps({accessibilityLabel:'Continue'}).props.onPress());
  act(()=>vi.runAllTimers());expect(nativeFocus).not.toHaveBeenCalled();act(()=>tree.unmount());
 });
 it('does not restore focus when the page unmounts or another dialog opens first',()=>{
  vi.useFakeTimers();let tree:any;
  act(()=>{tree=create(React.createElement(ActivityView,props),{createNodeMock:(element:any)=>({tag:element.props.accessibilityLabel?.startsWith('Open activity:')?42:17})});});
  act(()=>tree.root.findAll((node:any)=>node.type==='Pressable'&&node.props.accessibilityLabel?.startsWith('Open activity:'))[0].props.onPress());
  act(()=>tree.update(React.createElement(ActivityView,{...props,selected:transaction})));
  act(()=>tree.update(React.createElement(ActivityView,props)));
  act(()=>tree.update(React.createElement(ActivityView,{...props,selected:transaction})));
  act(()=>vi.runAllTimers());expect(nativeFocus).not.toHaveBeenCalledWith(42);act(()=>tree.unmount());
 });
});