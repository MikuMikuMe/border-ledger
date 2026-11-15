import {createRequire} from 'node:module';
import {describe,expect,it,vi} from 'vitest';
const require=createRequire(new URL('../mobile/package.json',import.meta.url));
const React=require('react');const {create,act}=require('react-test-renderer');
vi.mock('../mobile/node_modules/react-native/index.js',()=>({NativeModules:{},Text:'Text',View:'View',Pressable:'Pressable',TextInput:'TextInput',ScrollView:'ScrollView',Modal:'Modal',KeyboardAvoidingView:'KeyboardAvoidingView',AccessibilityInfo:{setAccessibilityFocus:()=>{}},findNodeHandle:()=>null,StyleSheet:{create:(v:unknown)=>v}}));
const api=vi.hoisted(()=>({readCategories:vi.fn(async()=>JSON.stringify({categories:[{name:'Food',archived:false}]})),createCategory:vi.fn(async()=> '{}')}));
vi.mock('../mobile/src/native/specs/NativeLedger',()=>({default:api}));
const {CategoryPicker}=await import('../mobile/src/features/finance/CategoryPicker');
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
