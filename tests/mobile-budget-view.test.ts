import {createRequire} from 'node:module';
import {describe,expect,it,vi} from 'vitest';
const require=createRequire(new URL('../mobile/package.json',import.meta.url));
const React=require('react');const {create,act}=require('react-test-renderer');
vi.mock('../mobile/node_modules/react-native/index.js',()=>({Text:'Text',View:'View',Pressable:'Pressable',TextInput:'TextInput',ActivityIndicator:'ActivityIndicator',Modal:'Modal',KeyboardAvoidingView:'KeyboardAvoidingView',ScrollView:'ScrollView',AccessibilityInfo:{setAccessibilityFocus:()=>{}},findNodeHandle:()=>null,StyleSheet:{create:(v:unknown)=>v}}));
const {BudgetContent}=await import('../mobile/src/features/budget/BudgetContent');
(globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
describe('Android budget content',()=>{
 it('shows category balances and clearly labels unavailable accounts',()=>{
  let tree:any;act(()=>{tree=create(React.createElement(BudgetContent,{dark:false,currency:'CAD',view:{settings:{currency:'CAD'},summary:{month:'2026-10',cashMinor:null,unassignedMinor:null,categories:[{category:'Food',availableMinor:3500,assignedMinor:3000,activityMinor:-500,openingMinor:1000,targetMinor:5000,suggestedMinor:1500,suggestionBasis:'target',missingTransactionIds:[]}]},balances:[{id:'bank',accountId:'bank',name:'Bank',source:'unavailable',sourceCurrency:'CAD',sourceMinor:null,amountMinor:null,rateDate:null,observedAt:null}],activity:[],currentMonth:'2026-10',asOf:'2026-10-31T12:00:00Z',startMonth:'2026-10'},busy:false,onWrite:()=>{}}));});
  const output=JSON.stringify(tree.toJSON());expect(output).toContain('Food');expect(output).toContain('Unavailable');expect(output).toContain('Bank');expect(output).toContain('Suggested');
 });
});
