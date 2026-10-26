import {createRequire} from 'node:module';
import {it,expect,vi} from 'vitest';
import type {LunchFlowConnection} from '../contracts/lunchflow';
const require=createRequire(new URL('../mobile/package.json',import.meta.url));
const React=require('react'),{create,act}=require('react-test-renderer');
vi.mock('../mobile/node_modules/react-native/index.js',()=>({Text:'Text',View:'View',Pressable:'Pressable',StyleSheet:{create:(v:unknown)=>v}}));
const {LunchFlowControls}=await import('../mobile/src/features/details/LunchFlowControls');
(globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
const connected:LunchFlowConnection={userId:'second',ledgerId:'second-ledger',connectionId:'same-id',generation:2,adapter:'platform',configured:true,connected:true,canReconnect:true,reconnectRequired:false,remoteRevocation:'not_requested',reason:'connected',retryable:false};
const actions=()=>({message:null,authorize:vi.fn(),cancel:vi.fn(),disconnect:vi.fn()});
function render(value:LunchFlowConnection,callbacks=actions()) {
  const props={dark:false,value,disabled:false,actions:callbacks};let tree:any;
  act(()=>{tree=create(React.createElement(LunchFlowControls,props));});return {tree,props,callbacks};
}
function button(tree:any,label:string){return tree.root.findAll((n:any)=>n.type==='Pressable'&&n.props.accessibilityLabel===label)[0];}
function copy(tree:any){return tree.root.findAll((n:any)=>n.type==='Text').map((n:any)=>n.children.join('')).join(' ');}
const cases:Array<[Partial<LunchFlowConnection>,string,string|null]>=[
  [{},'Connected','Disconnect Lunch Flow'],
  [{configured:false,connected:false,canReconnect:false},'operator',null],
  [{connected:false,reason:'disconnected'},'disconnected','Connect Lunch Flow'],
  [{connected:false,reconnectRequired:true},'authorization again','Reconnect Lunch Flow'],
  [{adapter:'personal',connected:false,canReconnect:false},'requires the operator',null],
  [{connected:false,canReconnect:false,remoteRevocation:'pending',retryable:true},'pending','Retry Lunch Flow access removal'],
  [{connected:false,canReconnect:false,remoteRevocation:'failed',retryable:true},'failed','Retry Lunch Flow access removal'],
  [{connected:false,canReconnect:false,remoteRevocation:'uncertain',reason:'operation_uncertain'},'uncertain',null],
];
it.each(cases)('renders native connection truth and permitted controls %j',(overrides,message,action)=>{
  const {tree}=render({...connected,...overrides});expect(copy(tree)).toContain(message);
  const present=['Connect Lunch Flow','Reconnect Lunch Flow','Disconnect Lunch Flow','Retry Lunch Flow access removal'].filter(label=>button(tree,label));
  expect(present).toEqual(action?[action]:[]);act(()=>tree.unmount());
});
it('explains app-wide removal first and invalidates confirmation when the observed generation changes',()=>{
  const {tree,props,callbacks}=render(connected);
  act(()=>button(tree,'Disconnect Lunch Flow').props.onPress());
  expect(copy(tree)).toContain('across its bank feeds');expect(copy(tree)).toContain('Imported history stays');expect(callbacks.disconnect).not.toHaveBeenCalled();
  act(()=>tree.update(React.createElement(LunchFlowControls,{...props,value:{...connected,generation:4}})));
  expect(button(tree,'Confirm Lunch Flow disconnect')).toBeUndefined();
  act(()=>button(tree,'Disconnect Lunch Flow').props.onPress());
  act(()=>button(tree,'Confirm Lunch Flow disconnect').props.onPress());
  expect(callbacks.disconnect).toHaveBeenCalledExactlyOnceWith({connectionId:'same-id',expectedGeneration:4});act(()=>tree.unmount());
});
it('explains Personal operator restoration before sending the captured removal intent',()=>{
  const {tree,callbacks}=render({...connected,adapter:'personal'});
  act(()=>button(tree,'Disconnect Lunch Flow').props.onPress());expect(copy(tree)).toContain('requires the operator');expect(callbacks.disconnect).not.toHaveBeenCalled();
  act(()=>button(tree,'Confirm Lunch Flow disconnect').props.onPress());expect(callbacks.disconnect).toHaveBeenCalledExactlyOnceWith({connectionId:'same-id',expectedGeneration:2});act(()=>tree.unmount());
});
