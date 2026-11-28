import {expect,it,vi} from 'vitest';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../mobile/package.json',import.meta.url));
const React=require('../mobile/node_modules/react');
const {act,create}=require('react-test-renderer');
vi.mock('../mobile/node_modules/react-native/index.js',()=>({
 Text:'Text',View:'View',Pressable:'Pressable',ActivityIndicator:'ActivityIndicator',TextInput:'TextInput',Modal:'Modal',KeyboardAvoidingView:'KeyboardAvoidingView',ScrollView:'ScrollView',
 AccessibilityInfo:{setAccessibilityFocus:()=>{}},findNodeHandle:()=>null,StyleSheet:{create:(value:unknown)=>value},
}));
const {ReceiptOcrSettings}=await import('../mobile/src/features/finance/ReceiptOcrSettings');
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
it('offers independent Microsoft and compatible vision provider settings',async()=>{
 let tree:any;const execute=vi.fn(async(_action:string,_body:string)=>JSON.stringify(null));
 await act(async()=>{tree=create(React.createElement(ReceiptOcrSettings,{dark:false,disabled:false,execute,onConfiguration:()=>{}}));});
 act(()=>tree.root.findByProps({accessibilityLabel:'Receipt OCR provider settings'}).props.onPress());
 expect(tree.root.findAllByProps({accessibilityLabel:'Use Microsoft Document Intelligence'})).toHaveLength(1);
 expect(tree.root.findAllByProps({accessibilityLabel:'Use OpenAI'})).toHaveLength(1);
 expect(tree.root.findAllByProps({accessibilityLabel:'Use Anthropic'})).toHaveLength(1);
 act(()=>tree.unmount());
});
it('saves an official vision provider through OCR settings',async()=>{
 let tree:any;const execute=vi.fn(async(_action:string,_body:string)=>JSON.stringify(null));
 await act(async()=>{tree=create(React.createElement(ReceiptOcrSettings,{dark:false,disabled:false,execute,onConfiguration:()=>{}}));});
 act(()=>tree.root.findByProps({accessibilityLabel:'Receipt OCR provider settings'}).props.onPress());
 act(()=>tree.root.findByProps({accessibilityLabel:'Use Anthropic'}).props.onPress());
 act(()=>{tree.root.findByProps({accessibilityLabel:'OCR vision model'}).props.onChangeText('vision-model');tree.root.findByProps({accessibilityLabel:'OCR provider key'}).props.onChangeText('ocr-key');});
 await act(async()=>{tree.root.findByProps({accessibilityLabel:'Save OCR settings'}).props.onPress();await Promise.resolve();});
 const saved=execute.mock.calls.find(([action]:string[])=>action==='ocr_configuration');
 expect(JSON.parse(saved![1] as string)).toEqual({provider:'anthropic',endpoint:'https://api.anthropic.com/v1/messages',model:'vision-model',credential:'ocr-key'});
 expect(tree.root.findByProps({accessibilityLabel:'OCR provider key'}).props.value).toBe('');
 act(()=>tree.unmount());
});
it('disables a previously saved custom endpoint',async()=>{
 let tree:any;const onConfiguration=vi.fn();const execute=vi.fn(async()=>JSON.stringify({provider:'anthropic',endpoint:'https://old.vendor.com/v1',model:'vision',revision:'r1'}));
 await act(async()=>{tree=create(React.createElement(ReceiptOcrSettings,{dark:false,disabled:false,execute,onConfiguration}));});
 expect(onConfiguration).toHaveBeenLastCalledWith(null);
 expect(JSON.stringify(tree.toJSON())).toContain('Custom OCR endpoints are no longer supported');
 act(()=>tree.unmount());
});
