import {createRequire} from 'node:module';
import {describe,expect,it,vi} from 'vitest';
const require=createRequire(new URL('../mobile/package.json',import.meta.url));
const React=require('react');const {create,act}=require('react-test-renderer');
vi.mock('../mobile/node_modules/react-native/index.js',()=>({Text:'Text',View:'View',Pressable:'Pressable',TextInput:'TextInput',ActivityIndicator:'ActivityIndicator',Modal:'Modal',KeyboardAvoidingView:'KeyboardAvoidingView',ScrollView:'ScrollView',BackHandler:{addEventListener:()=>({remove(){}})},AccessibilityInfo:{setAccessibilityFocus:()=>{}},findNodeHandle:()=>null,StyleSheet:{create:(v:unknown)=>v}}));
const {BudgetContent}=await import('../mobile/src/features/budget/BudgetContent');
(globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
describe('Android budget content',()=>{
 it('shows category balances and clearly labels unavailable accounts',()=>{
  let tree:any;act(()=>{tree=create(React.createElement(BudgetContent,{dark:false,currency:'CAD',view:{settings:{currency:'CAD'},summary:{month:'2026-10',cashMinor:null,unassignedMinor:null,categories:[{category:'Food',availableMinor:3500,assignedMinor:3000,activityMinor:-500,openingMinor:1000,targetMinor:5000,suggestedMinor:1500,suggestionBasis:'target',missingTransactionIds:[]}]},balances:[{id:'bank',accountId:'bank',name:'Bank',source:'unavailable',sourceCurrency:'CAD',sourceMinor:null,amountMinor:null,rateDate:null,observedAt:null}],activity:[],currentMonth:'2026-10',asOf:'2026-10-31T12:00:00Z',startMonth:'2026-10'},busy:false,onWrite:()=>{}}));});
  const output=JSON.stringify(tree.toJSON());expect(output).toContain('Food');expect(output).toContain('Unavailable');expect(output).toContain('Bank');expect(output).toContain('Suggested');
  expect(tree.root.findByProps({accessibilityLabel:'Edit envelope Food'}).props.accessibilityValue?.text).toBe('Assigned CAD 30.00. Activity CAD -5.00. Available CAD 35.00. Carried CAD 10.00.');
 });
 it('keeps rollover drafts when previewing from the envelope editor',()=>{
  const preview=vi.fn(),view={settings:{currency:'CAD'},summary:{month:'2026-10',cashMinor:0,unassignedMinor:0,categories:[{category:'Food',availableMinor:0,assignedMinor:0,activityMinor:0,openingMinor:0,targetMinor:null,suggestedMinor:null,suggestionBasis:null,missingTransactionIds:[]}]},balances:[],activity:[],currentMonth:'2026-10',asOf:'now',startMonth:'2026-10'};
  let tree:any;act(()=>{tree=create(React.createElement(BudgetContent,{dark:false,currency:'CAD',view,busy:false,onWrite:()=>{},onRollover:preview}));});
  act(()=>tree.root.findByProps({accessibilityLabel:'Edit envelope Food'}).props.onPress());
  expect(tree.root.findByType('Modal').props.visible).toBe(true);
  act(()=>tree.root.findByProps({accessibilityLabel:'Outgoing month for Food'}).props.onChangeText('2026-11'));
  act(()=>tree.root.findByProps({accessibilityLabel:'Preview rollover for Food'}).props.onPress());
  expect(preview).toHaveBeenCalledWith('Food','2026-11','carry_all');expect(tree.root.findAllByType('Modal')).toHaveLength(0);
  act(()=>tree.root.findByProps({accessibilityLabel:'Edit envelope Food'}).props.onPress());
  expect(tree.root.findByProps({accessibilityLabel:'Outgoing month for Food'}).props.value).toBe('2026-11');
 });
});
