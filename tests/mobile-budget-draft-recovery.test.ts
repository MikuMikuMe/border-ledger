import {createRequire} from 'node:module';
import {expect,it,vi} from 'vitest';
const require=createRequire(new URL('../mobile/package.json',import.meta.url));
const React=require('react'),{create,act}=require('react-test-renderer');
vi.mock('../mobile/node_modules/react-native/index.js',()=>({Text:'Text',View:'View',Pressable:'Pressable',TextInput:'TextInput',ActivityIndicator:'ActivityIndicator',Modal:'Modal',KeyboardAvoidingView:'KeyboardAvoidingView',ScrollView:'ScrollView',BackHandler:{addEventListener:()=>({remove(){}})},AccessibilityInfo:{setAccessibilityFocus:()=>{}},findNodeHandle:()=>null,StyleSheet:{create:(v:unknown)=>v}}));
const stub=vi.hoisted(()=>({current:null as any}));
vi.mock('../mobile/src/features/budget/useMobileBudget',()=>({useMobileBudget:()=>stub.current}));
vi.mock('../mobile/src/features/budget/AnalysisContent',()=>({AnalysisContent:()=>null}));
const {BudgetScreen}=await import('../mobile/src/screens/BudgetScreen');
(globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
it('retains an open dirty forecast while refreshing a409 conflict and another revision',()=>{
 const view={mode:'tracking',settings:{currency:'CAD',revision:4},summary:{month:'2026-10',plannedIncomeMinor:0,plannedExpenseMinor:10000,plannedSavingsMinor:-10000,actualIncomeMinor:0,actualExpenseMinor:0,actualSavingsMinor:0,categories:[{direction:'expense',category:'Food',plannedMinor:10000,actualMinor:0,varianceMinor:10000,missingTransactionIds:[]}]},plans:[],activity:[],asOf:'now',currentMonth:'2026-10'};
 stub.current={month:'2026-10',draftMonth:'2026-10',mode:'tracking',configured:true,loading:false,previewLoading:false,mutation:{blocked:false,status:'ready'},view,write:()=>{},load:()=>{}};
 let tree:any;act(()=>{tree=create(React.createElement(BudgetScreen,{dark:false,showAnalysis:false}));});
 act(()=>tree.root.findByProps({accessibilityLabel:'Edit expense Food'}).props.onPress());
 act(()=>tree.root.findByProps({accessibilityLabel:'Planned expense for Food'}).props.onChangeText('125.50'));
 act(()=>{stub.current={...stub.current,loading:true};tree.update(React.createElement(BudgetScreen,{dark:false,showAnalysis:false}));});
 expect(tree.root.findByProps({accessibilityLabel:'Planned expense for Food'}).props.value).toBe('125.50');
 act(()=>{stub.current={...stub.current,loading:false,view:{...view,settings:{...view.settings,revision:5}}};tree.update(React.createElement(BudgetScreen,{dark:false,showAnalysis:false}));});
 expect(tree.root.findByProps({accessibilityLabel:'Planned expense for Food'}).props.value).toBe('125.50');act(()=>tree.unmount());
});

it('shows budget save errors inside the open forecast editor',()=>{
 const view={mode:'tracking',settings:{currency:'CAD',revision:4},summary:{month:'2026-10',plannedIncomeMinor:0,plannedExpenseMinor:10000,plannedSavingsMinor:-10000,actualIncomeMinor:0,actualExpenseMinor:0,actualSavingsMinor:0,categories:[{direction:'expense',category:'Food',plannedMinor:10000,actualMinor:0,varianceMinor:10000,missingTransactionIds:[]}]},plans:[],activity:[],asOf:'now',currentMonth:'2026-10'};
 stub.current={month:'2026-10',draftMonth:'2026-10',mode:'tracking',configured:true,loading:false,previewLoading:false,mutation:{blocked:false,status:'ready'},view,write:()=>{},load:()=>{}};
 let tree:any;act(()=>{tree=create(React.createElement(BudgetScreen,{dark:false,showAnalysis:false}));});
 act(()=>tree.root.findByProps({accessibilityLabel:'Edit expense Food'}).props.onPress());
 act(()=>tree.root.findByProps({accessibilityLabel:'Save expense plan for Food'}).props.onPress());
 act(()=>{stub.current={...stub.current,error:'Could not save forecast'};tree.update(React.createElement(BudgetScreen,{dark:false,showAnalysis:false}));});
 expect(JSON.stringify(tree.root.findByType('Modal').findAllByType('Text').map((n:any)=>n.children))).toContain('Could not save forecast');
});

it('opens a rollover preview for explicit confirmation',()=>{
 stub.current={month:'2026-10',draftMonth:'2026-10',mode:'envelope',configured:true,loading:false,previewLoading:false,mutation:{blocked:false,status:'ready'},view:null,write:()=>{},load:()=>{},cancelPreview:()=>{},rolloverPreview:{category:'Food',effectiveMonth:'2026-10',policy:'reset',revision:1,changes:[]}};
 let tree:any;act(()=>{tree=create(React.createElement(BudgetScreen,{dark:false,showAnalysis:false}));});
 expect(tree.root.findByType('Modal').findByProps({accessibilityLabel:'Confirm rollover policy'})).toBeTruthy();
});
