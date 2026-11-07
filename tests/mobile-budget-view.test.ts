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
  act(()=>tree.root.findByProps({accessibilityLabel:'Edit envelope Food'}).props.onPress());
  expect(tree.root.findByProps({accessibilityLabel:'Assignment for Food'}).props.value).toBe('30.00');
  expect(tree.root.findByProps({accessibilityLabel:'Target for Food'}).props.value).toBe('50.00');
  expect(tree.root.findByProps({accessibilityLabel:'Assignment for Food'}).props.keyboardType).toBe('numeric');
  act(()=>tree.root.findByProps({accessibilityLabel:'Assignment for Food'}).props.onChangeText('invalid'));
  act(()=>tree.root.findByProps({accessibilityLabel:'Save assignment for Food'}).props.onPress());
  expect(JSON.stringify(tree.root.findByType('Modal').findAllByType('Text').map((n:any)=>n.children))).toContain('Enter a valid assignment.');
 });
 it('keeps invalid new assignments next to their amount field',()=>{
  const write=vi.fn(),view={settings:{currency:'CAD'},summary:{month:'2026-10',cashMinor:0,unassignedMinor:0,categories:[]},balances:[],activity:[],currentMonth:'2026-10',asOf:'now',startMonth:'2026-10'};
  let tree:any;act(()=>{tree=create(React.createElement(BudgetContent,{dark:false,currency:'CAD',view,busy:false,onWrite:write}));});
  act(()=>tree.root.findByProps({accessibilityLabel:'Amount to assign'}).props.onChangeText('invalid'));
  act(()=>tree.root.findByProps({accessibilityLabel:'Assign money'}).props.onPress());
  expect(write).not.toHaveBeenCalled();expect(JSON.stringify(tree.toJSON())).toContain('Enter a valid amount.');
  act(()=>tree.root.findByProps({accessibilityLabel:'Category'}).props.onChangeText('Food'));
  act(()=>tree.root.findByProps({accessibilityLabel:'Amount to assign'}).props.onChangeText('12.34'));
  act(()=>tree.root.findByProps({accessibilityLabel:'Assign money'}).props.onPress());
  expect(write.mock.calls[0][1]('op')).toEqual({month:'2026-10',category:'Food',assignedMinor:1234});
 });
 it('shows invalid move and custom balance amounts beside their fields',()=>{
  const write=vi.fn(),row=(category:string)=>({category,availableMinor:0,assignedMinor:0,activityMinor:0,openingMinor:0,targetMinor:null,suggestedMinor:null,suggestionBasis:null,missingTransactionIds:[]}),view={settings:{currency:'CAD'},summary:{month:'2026-10',cashMinor:0,unassignedMinor:0,categories:[row('Food'),row('Rent')]},balances:[],activity:[],currentMonth:'2026-10',asOf:'now',startMonth:'2026-10'};
  let tree:any;act(()=>{tree=create(React.createElement(BudgetContent,{dark:false,currency:'CAD',view,busy:false,onWrite:write}));});
  act(()=>tree.root.findByProps({accessibilityLabel:'Move from Food'}).props.onPress());act(()=>tree.root.findByProps({accessibilityLabel:'Move to Rent'}).props.onPress());
  act(()=>tree.root.findByProps({accessibilityLabel:'Amount to move'}).props.onChangeText('bad'));act(()=>tree.root.findByProps({accessibilityLabel:'Move money'}).props.onPress());
  act(()=>tree.root.findByProps({accessibilityLabel:'Balance amount'}).props.onChangeText('bad'));act(()=>tree.root.findByProps({accessibilityLabel:'Save custom balance'}).props.onPress());
  expect(write).not.toHaveBeenCalled();expect(tree.root.findAllByProps({accessibilityRole:'alert'})).toHaveLength(2);
  act(()=>tree.root.findByProps({accessibilityLabel:'Amount to move'}).props.onChangeText('2.50'));act(()=>tree.root.findByProps({accessibilityLabel:'Move money'}).props.onPress());
  act(()=>tree.root.findByProps({accessibilityLabel:'Balance name'}).props.onChangeText('Cash'));act(()=>tree.root.findByProps({accessibilityLabel:'Balance amount'}).props.onChangeText('-3.25'));act(()=>tree.root.findByProps({accessibilityLabel:'Save custom balance'}).props.onPress());
  expect(write.mock.calls[0][1]('op')).toEqual({id:'op',month:'2026-10',from:'Food',to:'Rent',amountMinor:250});
  expect(write.mock.calls[1][1]('op')).toEqual({id:'op',name:'Cash',currency:'CAD',amountMinor:-325});
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
 it('shows counted activity as a readable row with the original currency',()=>{
  const view={settings:{currency:'CAD'},summary:{month:'2026-10',cashMinor:0,unassignedMinor:0,categories:[]},balances:[],activity:[{id:'t1',date:'2026-10-03',category:'Food',sourceCurrency:'CNY',sourceMinor:1000,activityMinor:200,rateDate:'2026-10-03',rate:'0.2'}],currentMonth:'2026-10',asOf:'now',startMonth:'2026-10'};
  let tree:any;act(()=>{tree=create(React.createElement(BudgetContent,{dark:false,currency:'CAD',view,busy:false,onWrite:()=>{}}));});
  expect(tree.root.findAll((node:any)=>node.props.accessibilityLabel?.includes('Food, 2026-10-03, CAD 2.00'))).toHaveLength(1);
  expect(JSON.stringify(tree.toJSON())).toContain('Original');expect(JSON.stringify(tree.toJSON())).toContain('0.2');
  const sameCurrency={...view,activity:[{...view.activity[0],sourceCurrency:'CAD',sourceMinor:1000,activityMinor:-1000}]};
  act(()=>tree.update(React.createElement(BudgetContent,{dark:false,currency:'CAD',view:sameCurrency,busy:false,onWrite:()=>{}})));
  expect(JSON.stringify(tree.toJSON())).toContain('Original');
 });
});
