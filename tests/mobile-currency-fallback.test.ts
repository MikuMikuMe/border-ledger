import {createRequire} from 'node:module';
import {describe,it,expect,vi} from 'vitest';
import names from '../mobile/src/features/finance/currency-names.en.json';
import {supportedCurrencyCodes} from '../src/domain/currencies';
const require=createRequire(new URL('../mobile/package.json',import.meta.url));
const React=require('react'),{create,act}=require('react-test-renderer');
vi.mock('../mobile/node_modules/react-native/index.js',()=>({NativeModules:{},Text:'Text',View:'View',Pressable:'Pressable',TextInput:'TextInput',ActivityIndicator:'ActivityIndicator',Modal:'Modal',KeyboardAvoidingView:'KeyboardAvoidingView',ScrollView:'ScrollView',AccessibilityInfo:{setAccessibilityFocus:()=>{}},findNodeHandle:()=>null,StyleSheet:{create:(v:unknown)=>v}}));
const limitedIntl=Object.create(Intl);limitedIntl.DisplayNames=undefined;vi.stubGlobal('Intl',limitedIntl);
const {CurrencyPicker}=await import('../mobile/src/features/finance/CurrencyPicker');
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
describe('currency name fallback',()=>{
 it('covers every supported currency code',()=>{expect(Object.keys(names).sort()).toEqual([...supportedCurrencyCodes].sort());});
 it('finds a currency by name without Intl.DisplayNames',()=>{
  let tree:any;act(()=>{tree=create(React.createElement(CurrencyPicker,{dark:false,accountCurrency:'CAD',value:'CAD',disabled:false,onChange:vi.fn()}));});
  act(()=>tree.root.findByProps({accessibilityLabel:'More currencies'}).props.onPress());
  act(()=>tree.root.findByProps({accessibilityLabel:'Search currencies'}).props.onChangeText('euro'));
  expect(tree.root.findByProps({accessibilityLabel:'EUR'})).toBeTruthy();act(()=>tree.unmount());
 });
});
