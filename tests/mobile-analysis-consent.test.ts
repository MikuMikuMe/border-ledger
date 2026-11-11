import {createRequire} from 'node:module';
import {expect,it,vi} from 'vitest';
const require=createRequire(new URL('../mobile/package.json',import.meta.url));
const React=require('react');const {create,act}=require('react-test-renderer');
const nativeFocus=vi.hoisted(()=>vi.fn());
vi.mock('../mobile/node_modules/react-native/index.js',()=>({NativeModules:{NativeAccessibilityFocus:{focus:nativeFocus}},Platform:{OS:'android'},Text:'Text',View:'View',Switch:'Switch',Pressable:'Pressable',TextInput:'TextInput',ActivityIndicator:'ActivityIndicator',Modal:'Modal',KeyboardAvoidingView:'KeyboardAvoidingView',ScrollView:'ScrollView',AccessibilityInfo:{setAccessibilityFocus:()=>{}},findNodeHandle:(node:any)=>node?.tag??null,StyleSheet:{create:(v:unknown)=>v}}));
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

it('keeps provider errors and the draft visible in the settings panel',async()=>{
 const execute=vi.fn((action:string)=>action==='settings'?Promise.resolve('{"configurations":[],"detailedTransactions":false}'):Promise.reject(new Error('Cannot save')));
 let tree:any;await act(async()=>{tree=create(React.createElement(AnalysisContent,{dark:false,month:'2026-10',execute}));});
 act(()=>tree.root.findByProps({accessibilityLabel:'Show provider and privacy settings'}).props.onPress());
 expect(tree.root.findAllByType('Modal')).toHaveLength(1);
 act(()=>tree.root.findByProps({accessibilityLabel:'Model'}).props.onChangeText('test'));
 act(()=>tree.root.findByProps({accessibilityLabel:'API key'}).props.onChangeText('secret'));
 await act(async()=>{tree.root.findByProps({accessibilityLabel:'Save or replace key'}).props.onPress();await Promise.resolve();});
 expect(JSON.stringify(tree.root.findByType('Modal').findAllByType('Text').map((n:any)=>n.children))).toContain('Cannot save');
 expect(tree.root.findByProps({accessibilityLabel:'API key'}).props.value).toBe('secret');
 act(()=>tree.root.findByProps({accessibilityLabel:'Dismiss Provider and privacy settings'}).props.onPress());
 act(()=>tree.root.findByProps({accessibilityLabel:'Show provider and privacy settings'}).props.onPress());
 expect(tree.root.findByProps({accessibilityLabel:'API key'}).props.value).toBe('secret');
});

it('returns focus to provider settings after closing',async()=>{
 vi.useFakeTimers();nativeFocus.mockClear();let tree:any;
 await act(async()=>{tree=create(React.createElement(AnalysisContent,{dark:false,month:'2026-10'}),{createNodeMock:(element:any)=>({tag:element.props.accessibilityLabel==='Show provider and privacy settings'?111:17})});});
 act(()=>tree.root.findByProps({accessibilityLabel:'Show provider and privacy settings'}).props.onPress());
 act(()=>tree.root.findByProps({accessibilityLabel:'Dismiss Provider and privacy settings'}).props.onPress());
 act(()=>vi.runAllTimers());expect(nativeFocus).toHaveBeenCalledWith(111);act(()=>tree.unmount());vi.useRealTimers();
});
