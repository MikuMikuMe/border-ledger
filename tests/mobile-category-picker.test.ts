import {createRequire} from 'node:module';
import {describe,expect,it,vi} from 'vitest';
const require=createRequire(new URL('../mobile/package.json',import.meta.url));
const React=require('react');const {create,act}=require('react-test-renderer');
vi.mock('../mobile/node_modules/react-native/index.js',()=>({NativeModules:{},Text:'Text',View:'View',Pressable:'Pressable',TextInput:'TextInput',ScrollView:'ScrollView',Modal:'Modal',KeyboardAvoidingView:'KeyboardAvoidingView',AccessibilityInfo:{setAccessibilityFocus:()=>{}},findNodeHandle:()=>null,StyleSheet:{create:(v:unknown)=>v}}));
const api=vi.hoisted(()=>({readCategories:vi.fn(async()=>JSON.stringify({categories:[{name:'Food',archived:false}]})),createCategory:vi.fn(async()=> '{}'),categoryAction:vi.fn(async(action:string)=>action==='preview'?JSON.stringify({from:'Food',to:'Dining',transactions:1,budget:{},conflicts:[],version:'v1'}):'{}')}));
vi.mock('../mobile/src/native/specs/NativeLedger',()=>({default:api}));
const {CategoryPicker}=await import('../mobile/src/features/finance/CategoryPicker');
const {ActivityDetail}=await import('../mobile/src/features/finance/FinanceViews');
const {CategoryServicesContext}=await import('../mobile/src/features/finance/categoryServices');
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
describe('mobile category picker',()=>{
 it('selects an existing category and explicitly creates a new one',async()=>{
  const onChange=vi.fn();let tree:any;
  await act(async()=>{tree=create(React.createElement(CategoryServicesContext.Provider,{value:api},React.createElement(CategoryPicker,{dark:false,value:'',disabled:false,onChange})));});
  expect(tree.root.findAll((n:any)=>n.type==='Pressable'&&n.props.accessibilityLabel==='Choose category')[0].props.accessibilityValue).toEqual({text:'No category selected'});
  act(()=>tree.root.findByProps({accessibilityLabel:'Choose category'}).props.onPress());
  act(()=>tree.root.findByProps({accessibilityLabel:'Food'}).props.onPress());
  expect(onChange).toHaveBeenCalledWith('Food');
  act(()=>tree.root.findByProps({accessibilityLabel:'Choose category'}).props.onPress());
  act(()=>tree.root.findByProps({accessibilityLabel:'Search or add a category'}).props.onChangeText('Coffee'));
  await act(async()=>tree.root.findByProps({accessibilityLabel:'Create category'}).props.onPress());
  expect(api.createCategory).toHaveBeenCalledWith('Coffee');expect(onChange).toHaveBeenCalledWith('Coffee');act(()=>tree.unmount());
 });
});

describe('mobile category cleanup',()=>{
 it('notifies the open transaction editor after cleanup succeeds',async()=>{
  const onChange=vi.fn(),onCleanup=vi.fn(async()=>true);let tree:any;
  await act(async()=>{tree=create(React.createElement(CategoryServicesContext.Provider,{value:api},React.createElement(CategoryPicker,{dark:false,value:'Food',disabled:false,onChange,onCleanup})));});
  act(()=>tree.root.findByProps({accessibilityLabel:'Manage categories'}).props.onPress());
  act(()=>tree.root.findByProps({accessibilityLabel:'Manage Food'}).props.onPress());
  act(()=>tree.root.findByProps({accessibilityLabel:'Rename or merge into'}).props.onChangeText('Dining'));
  await act(async()=>tree.root.findByProps({accessibilityLabel:'Preview changes'}).props.onPress());
  await act(async()=>tree.root.findByProps({accessibilityLabel:'Confirm changes'}).props.onPress());
  expect(onChange).toHaveBeenCalledWith('Dining');
  expect(onCleanup).toHaveBeenCalledWith({from:'Food',to:'Dining'});
  act(()=>tree.unmount());
 });
});
describe('mobile activity category refresh',()=>{
 it('blocks annotation saves when category cleanup cannot refresh the open transaction',async()=>{
  const selected={id:'tx',occurredAt:'2026-10-10',currency:'CAD',signedMinorUnits:'-1200',merchant:'Coffee',accountLabel:null,status:'confirmed',sourceLabel:null,category:'Food',note:null,kind:'expense',revision:3,accountId:null};
  let tree:any;
  await act(async()=>{tree=create(React.createElement(CategoryServicesContext.Provider,{value:api},React.createElement(ActivityDetail,{dark:false,selected,draft:{category:'Food',note:'Keep this note'},mutation:{blocked:false,status:'ready'},onDraft:vi.fn(),onSave:vi.fn(),onClose:vi.fn(),onCategoryCleanup:async()=>false})));});
  act(()=>tree.root.findByProps({accessibilityLabel:'Manage categories'}).props.onPress());
  act(()=>tree.root.findByProps({accessibilityLabel:'Manage Food'}).props.onPress());
  act(()=>tree.root.findByProps({accessibilityLabel:'Rename or merge into'}).props.onChangeText('Dining'));
  await act(async()=>tree.root.findByProps({accessibilityLabel:'Preview changes'}).props.onPress());
  await act(async()=>tree.root.findByProps({accessibilityLabel:'Confirm changes'}).props.onPress());
  expect(tree.root.findByProps({accessibilityLabel:'Save annotation'}).props.disabled).toBe(true);
  expect(JSON.stringify(tree.toJSON())).toContain('transaction could not be refreshed');
  act(()=>tree.unmount());
 });
});
