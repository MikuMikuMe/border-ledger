import {createRequire} from 'node:module';
import {expect,it,vi} from 'vitest';
const require=createRequire(new URL('../mobile/package.json',import.meta.url));
const React=require('react');const {create,act}=require('react-test-renderer');
vi.mock('../mobile/node_modules/react-native/index.js',()=>({Text:'Text',View:'View',Switch:'Switch',Pressable:'Pressable',TextInput:'TextInput',ActivityIndicator:'ActivityIndicator',Modal:'Modal',KeyboardAvoidingView:'KeyboardAvoidingView',ScrollView:'ScrollView',AccessibilityInfo:{setAccessibilityFocus:()=>{}},findNodeHandle:()=>null,StyleSheet:{create:(v:unknown)=>v}}));
vi.mock('../mobile/src/native/specs/NativeAnalysis',()=>({default:{execute:async()=>'{"configurations":[],"detailedTransactions":false}'}}));
const {AnalysisContent}=await import('../mobile/src/features/budget/AnalysisContent');
(globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
it('discards an Android preview when the user changes the requested analysis',async()=>{
 let finish!:(value:string)=>void;
 const execute=vi.fn((action:string)=>action==='preview'?new Promise<string>(resolve=>{finish=resolve;}):Promise.resolve(JSON.stringify({configurations:[{provider:'openai',model:'test'}],detailedTransactions:false})));
 let tree:any;await act(async()=>{tree=create(React.createElement(AnalysisContent,{dark:false,month:'2026-10',execute}));});
 const button=(label:string)=>tree.root.findAllByType('Pressable').find((node:any)=>node.props.accessibilityLabel===label);
 act(()=>button('Review request').props.onPress());
 act(()=>button('Switch to full ledger').props.onPress());
 await act(async()=>{finish(JSON.stringify({provider:'openai',model:'test',endpoint:'https://api.openai.com/v1/chat/completions',configurationRevision:'r1',from:'2026-10-01',to:'2026-10-31',detail:false,mode:'budget'}));});
 expect(button('Send for analysis')).toBeUndefined();
 act(()=>tree.unmount());
});
