import {createRequire} from 'node:module';
import {describe,expect,it,vi} from 'vitest';
const require=createRequire(new URL('../mobile/package.json',import.meta.url));
const React=require('react');
const {create,act}=require('react-test-renderer');
vi.mock('../mobile/node_modules/react-native/index.js',()=>({NativeModules:{},Text:'Text',View:'View',Pressable:'Pressable',TextInput:'TextInput',ActivityIndicator:'ActivityIndicator',Modal:'Modal',KeyboardAvoidingView:'KeyboardAvoidingView',ScrollView:'ScrollView',AccessibilityInfo:{setAccessibilityFocus:()=>{}},findNodeHandle:()=>null,StyleSheet:{create:(v:unknown)=>v}}));
const native=vi.hoisted(()=>({write:vi.fn(async()=>({status:'completed'})),matches:[] as unknown[],operations:[] as unknown[]}));
vi.mock('../mobile/src/native/specs/NativeLedger',()=>({default:{readManualMatches:async()=>JSON.stringify({matches:native.matches}),startManualWrite:native.write,onChanged:()=>({remove(){}})}}));
vi.mock('../mobile/src/native/specs/NativeSession',()=>({default:{readOperations:async()=>native.operations}}));
const {ManualTransactions}=await import('../mobile/src/features/finance/ManualTransactions');
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
const account={id:'boc',displayName:'Bank of China',institution:null,instrument:null,currencies:['CNY'],lastSuccessfulSyncAt:null};
const snapshot=(accounts:any[])=>({accounts,transactions:[]});
const makeController=(state:any)=>({snapshot:{current:()=>state},mutation:{current:()=>({blocked:false,status:'completed'}),submit:async(_:string,write:()=>Promise<unknown>)=>{await write();}},reload:vi.fn(),recover:vi.fn()});
async function render(state:any){
  const controller=makeController(state);let tree:any;
  await act(async()=>{tree=create(React.createElement(ManualTransactions,{dark:false,controller,operationId:()=> 'op',manualRequest:0}));});
  await act(async()=>{tree.update(React.createElement(ManualTransactions,{dark:false,controller,operationId:()=> 'op',manualRequest:1}));});
  return {tree,controller};
}
describe('manual transaction account states',()=>{
  it('opens the form with accounts without visiting Accounts',async()=>{
    const {tree}=await render({phase:'ready',data:snapshot([account]),message:null});
    expect(tree.root.findByProps({accessibilityLabel:'Description'})).toBeTruthy();
    expect(JSON.stringify(tree.toJSON())).not.toContain('Add an account before');
    act(()=>tree.unmount());
  });
  it('saves a manually entered transaction and reports success',async()=>{
    native.write.mockClear();const {tree}=await render({phase:'ready',data:snapshot([account]),message:null});
    for(const [label,value] of [['Description','Coffee'],['Amount','12.34'],['Category','Food']]){
      act(()=>tree.root.findByProps({accessibilityLabel:label}).props.onChangeText(value));
    }
    await act(async()=>{tree.root.findByProps({accessibilityLabel:'Save transaction'}).props.onPress();await new Promise(resolve=>setTimeout(resolve,0));});
    expect(native.write).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(tree.toJSON())).toContain('Transaction saved.');act(()=>tree.unmount());
  });
  it('opens the form when accounts finish loading after the menu was selected',async()=>{
    const state:any={phase:'loading',data:null,message:null};
    const {tree,controller}=await render(state);
    state.phase='ready';state.data=snapshot([account]);
    await act(async()=>{tree.update(React.createElement(ManualTransactions,{dark:false,controller,operationId:()=> 'op',manualRequest:1}));});
    expect(tree.root.findByProps({accessibilityLabel:'Description'})).toBeTruthy();act(()=>tree.unmount());
  });
  it.each(['loading','offline','error'])('does not call %s state an empty account list',async phase=>{
    const {tree,controller}=await render({phase,data:null,message:null});
    expect(JSON.stringify(tree.toJSON())).not.toContain('Add an account before');
    if(phase!=='loading'){
      const retry=tree.root.findByProps({accessibilityLabel:'Refresh accounts'});
      act(()=>retry.props.onPress());expect(controller.reload).toHaveBeenCalled();
    }
    act(()=>tree.unmount());
  });
  it('dismisses the account loading dialog outside',async()=>{
    const {tree}=await render({phase:'loading',data:null,message:null});
    act(()=>tree.root.findByProps({accessibilityLabel:'Dismiss Add transaction'}).props.onPress());
    expect(tree.root.findAllByType('Modal')).toHaveLength(0);act(()=>tree.unmount());
  });
  it('keeps duplicate review and submitted-change recovery visible',async()=>{
    native.matches=[{manualId:'manual',bankId:'bank',accountId:'boc',manualDate:'2026-11-08',bankDate:'2026-11-08',manualMerchant:'Coffee',bankMerchant:'Coffee',amountMinor:100,currency:'CNY',category:'Food',note:null,decision:'open',revision:1}];
    native.operations=[{operationId:'pending',kind:'manual_create',status:'reconciliation_required'}];
    const {tree}=await render({phase:'ready',data:snapshot([account]),message:null});
    expect(tree.root.findByProps({accessibilityLabel:'Confirm duplicate'})).toBeTruthy();
    expect(tree.root.findByProps({accessibilityLabel:'Retry submitted manual change'})).toBeTruthy();
    act(()=>tree.unmount());native.matches=[];native.operations=[];
  });
  it('shows the empty account message only after a successful empty read',async()=>{
    const {tree}=await render({phase:'ready',data:snapshot([]),message:null});
    expect(JSON.stringify(tree.toJSON())).toContain('Add an account before');act(()=>tree.unmount());
  });
});
