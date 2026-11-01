import {createRequire} from 'node:module';
import {expect,it,vi} from 'vitest';
const require=createRequire(new URL('../mobile/package.json',import.meta.url));
const React=require('react'),{create,act}=require('react-test-renderer');
vi.mock('../mobile/node_modules/react-native/index.js',()=>({Text:'Text',View:'View',Pressable:'Pressable',TextInput:'TextInput',ActivityIndicator:'ActivityIndicator',Modal:'Modal',KeyboardAvoidingView:'KeyboardAvoidingView',ScrollView:'ScrollView',BackHandler:{addEventListener:()=>({remove(){}})},AccessibilityInfo:{setAccessibilityFocus:()=>{}},findNodeHandle:()=>null,StyleSheet:{create:(v:unknown)=>v}}));
const {CopyPlanPreview,RolloverChangePreview}=await import('../mobile/src/features/budget/BudgetPreviews');
const {RolloverEditor}=await import('../mobile/src/features/budget/RolloverEditor');
(globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
it('requires confirmation before replacing plans and submits both preview revisions',()=>{
 const writes:any[]=[];let tree:any;act(()=>{tree=create(React.createElement(CopyPlanPreview,{dark:false,currency:'CAD',busy:false,preview:{month:'2026-11',sourceMonth:'2026-10',revision:8,sourceRevision:7,plans:[]},onWrite:(action:string,build:any)=>writes.push([action,build('copy-op')]),onCancel:()=>{}}));});
 expect(writes).toEqual([]);
 act(()=>tree.root.findByProps({accessibilityLabel:'Confirm copy previous month'}).props.onPress());
 expect(writes).toEqual([['tracking-copy',{month:'2026-11',sourceMonth:'2026-10',expectedRevision:8,expectedSourceRevision:7,operationId:'copy-op'}]]);act(()=>tree.unmount());
});
it('confirms the historical policy and unknown balances from the reviewed preview',()=>{
 const writes:any[]=[];let tree:any;act(()=>{tree=create(React.createElement(RolloverChangePreview,{dark:true,currency:'CAD',busy:false,preview:{category:'Food',effectiveMonth:'2026-09',policy:'reset',revision:11,changes:[{month:'2026-10',category:'Food',beforeOpeningMinor:null,afterOpeningMinor:0,beforeClosingMinor:null,afterClosingMinor:3000}]},onWrite:(action:string,build:any)=>writes.push([action,build('rollover-op')]),onCancel:()=>{}}));});
 expect(JSON.stringify(tree.toJSON())).toContain('Unavailable');expect(JSON.stringify(tree.toJSON())).toContain('Reset next month to zero');expect(writes).toEqual([]);
 act(()=>tree.root.findByProps({accessibilityLabel:'Confirm rollover policy'}).props.onPress());
 expect(writes).toEqual([['rollover',{category:'Food',effectiveMonth:'2026-09',policy:'reset',expectedRevision:11,operationId:'rollover-op'}]]);act(()=>tree.unmount());
});
it('invalidates an existing preview before changing its outgoing month or policy',()=>{
 const changes=vi.fn();let tree:any;act(()=>{tree=create(React.createElement(RolloverEditor,{dark:false,category:'Food',month:'2026-10',rules:[],busy:false,onPreview:()=>{},onChange:changes}));});
 act(()=>tree.root.findByProps({accessibilityLabel:'Reset next month to zero'}).props.onPress());
 act(()=>tree.root.findByProps({accessibilityLabel:'Outgoing month for Food'}).props.onChangeText('2026-09'));
 expect(changes).toHaveBeenCalledTimes(2);act(()=>tree.unmount());
});
