import {createRequire} from 'node:module';
import {expect,it,vi} from 'vitest';
const require=createRequire(new URL('../mobile/package.json',import.meta.url));
const React=require('react');const {create,act}=require('react-test-renderer');
vi.mock('../mobile/node_modules/react-native/index.js',()=>({Text:'Text',View:'View',Switch:'Switch',Pressable:'Pressable',TextInput:'TextInput',ActivityIndicator:'ActivityIndicator',Modal:'Modal',KeyboardAvoidingView:'KeyboardAvoidingView',ScrollView:'ScrollView',AccessibilityInfo:{setAccessibilityFocus:()=>{}},findNodeHandle:()=>null,StyleSheet:{create:(v:unknown)=>v}}));
vi.mock('../mobile/src/features/budget/useMobileBudget',()=>({useMobileBudget:()=>({month:'2026-11',draftMonth:'2026-11',setDraftMonth:()=>{},selectMonth:()=>{},loading:false,error:null,configured:true,view:{settings:{currency:'CAD'},summary:{month:'2026-10'}},mutation:{blocked:false},write:()=>{}})}));
vi.mock('../mobile/src/features/budget/AnalysisContent',()=>({AnalysisContent:()=>null}));
const {BudgetScreen}=await import('../mobile/src/screens/BudgetScreen');
(globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
it('does not render or enable editing for a view from a different month',()=>{
 let tree:any;act(()=>{tree=create(React.createElement(BudgetScreen,{dark:false}));});
 expect(JSON.stringify(tree.toJSON())).not.toContain('Available to assign');
 expect(tree.root.findAllByProps({accessibilityLabel:'Save assignment for Food'})).toHaveLength(0);
 act(()=>tree.unmount());
});
