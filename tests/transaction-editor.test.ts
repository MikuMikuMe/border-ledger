import {describe,it,expect,vi} from 'vitest';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../mobile/package.json',import.meta.url));
const React=require('react'),{create,act}=require('react-test-renderer');
vi.mock('../mobile/node_modules/react-native/index.js',()=>({Alert:{alert:alerts.show},NativeModules:{},Text:'Text',View:'View',Pressable:'Pressable',TextInput:'TextInput',ActivityIndicator:'ActivityIndicator',Modal:'Modal',KeyboardAvoidingView:'KeyboardAvoidingView',ScrollView:'ScrollView',AccessibilityInfo:{setAccessibilityFocus:()=>{}},findNodeHandle:()=>null,StyleSheet:{create:(v:unknown)=>v}}));
const alerts=vi.hoisted(()=>({show:vi.fn()}));
const api=vi.hoisted(()=>({write:vi.fn(async()=>({status:'completed'}))}));
vi.mock('../mobile/src/native/specs/NativeLedger',()=>({default:{startManualWrite:api.write}}));
vi.mock('../mobile/src/native/specs/NativeSession',()=>({default:{queryOperation:vi.fn()}}));
const {TransactionEditor}=await import('../mobile/src/features/finance/TransactionEditor');
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
describe('transaction editor',()=>{
 it('keeps a chosen currency when the selected account is tapped again',async()=>{
  const transaction={id:'tx',occurredAt:'2026-10-25',currency:'USD',signedMinorUnits:'1234',sourceAmountMinor:'-1234',merchant:'Store',accountId:'account',accountLabel:null,status:'confirmed',sourceLabel:'manual',category:'Food',note:null,kind:'expense',revision:0,editRevision:0};
  const controller={snapshot:{current:()=>({data:{accounts:[{id:'account',displayName:'Bank',institution:null,currencies:['CAD']}]}})},mutation:{current:()=>({blocked:false,status:'ready'})}};
  let tree:any;await act(async()=>{tree=create(React.createElement(TransactionEditor,{dark:false,transaction,controller,operationId:()=> 'operation_12345678',onClose:vi.fn(),onCategoryCleanup:async()=>true}));});
  act(()=>tree.root.findByProps({accessibilityLabel:' Bank'}).props.onPress());
  expect(tree.root.findByProps({accessibilityLabel:'USD'}).props.accessibilityState.checked).toBe(true);
  act(()=>tree.unmount());
 });

 it('submits edited fields and both revisions through the operation journal',async()=>{
  const transaction={id:'tx',occurredAt:'2026-10-25',currency:'CAD',signedMinorUnits:'1234',sourceAmountMinor:'-1234',merchant:'Store',accountId:'account',accountLabel:null,status:'confirmed',sourceLabel:'manual',category:'Food',note:null,kind:'expense',revision:2,editRevision:3};
  const controller={snapshot:{current:()=>({data:{accounts:[{id:'account',displayName:'Bank',institution:null,currencies:['CAD']}]}})},mutation:{current:()=>({blocked:false,status:'completed'}),submit:async(_:string,write:()=>Promise<unknown>)=>write()},reload:vi.fn()};
  const close=vi.fn();let tree:any;
  await act(async()=>{tree=create(React.createElement(TransactionEditor,{dark:false,transaction,controller,operationId:()=> 'operation_12345678',onClose:close,onCategoryCleanup:async()=>true}));});
  act(()=>tree.root.findByProps({accessibilityLabel:'Description'}).props.onChangeText('New store'));
  await act(async()=>{tree.root.findByProps({accessibilityLabel:'Save transaction'}).props.onPress();await Promise.resolve();});
  const [id,action,body]=api.write.mock.calls[0] as unknown as [string,string,string];
  expect(id).toBe('operation_12345678');expect(action).toBe('edit');expect(JSON.parse(body)).toMatchObject({merchant:'New store',transactionId:'tx',expectedRevision:3,expectedAnnotationRevision:2,amount:'12.34'});
  expect(close).toHaveBeenCalled();expect(controller.reload).toHaveBeenCalled();act(()=>tree.unmount());
 });
 it('keeps an unsaved draft open when category cleanup refresh fails',async()=>{
  const transaction={id:'tx',occurredAt:'2026-10-25',currency:'CAD',signedMinorUnits:'1234',sourceAmountMinor:'-1234',merchant:'Store',accountId:'account',accountLabel:null,status:'confirmed',sourceLabel:'manual',category:'Food',note:null,kind:'expense',revision:2,editRevision:3};
  const controller={snapshot:{current:()=>({data:{accounts:[]}})},mutation:{current:()=>({blocked:false,status:'idle'})}};
  const close=vi.fn(),refresh=vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);let tree:any;
  await act(async()=>{tree=create(React.createElement(TransactionEditor,{dark:false,transaction,controller,operationId:()=> 'operation_12345678',onClose:close,onCategoryCleanup:refresh}));});
  act(()=>tree.root.findByProps({accessibilityLabel:'Description'}).props.onChangeText('Unsaved description'));
  const form=tree.root.findByType((await import('../mobile/src/features/finance/ManualEntryForm')).ManualEntryForm);
  await act(async()=>{await form.props.onCategoryCleanup({from:'Food',to:'Groceries'});});
  expect(close).not.toHaveBeenCalled();expect(tree.root.findByProps({accessibilityLabel:'Description'}).props.value).toBe('Unsaved description');
  expect(tree.root.findByProps({accessibilityLabel:'Save transaction'}).props.accessibilityState.disabled).toBe(true);
  await act(async()=>{tree.root.findByProps({accessibilityLabel:'Refresh transaction'}).props.onPress();await Promise.resolve();});
  expect(refresh).toHaveBeenCalledTimes(2);expect(tree.root.findByProps({accessibilityLabel:'Description'}).props.value).toBe('Unsaved description');
  act(()=>tree.unmount());
 });

 it('offers a refresh after a concurrent change and reloads the latest fields',async()=>{
  const transaction={id:'tx',occurredAt:'2026-10-25',currency:'CAD',signedMinorUnits:'1234',sourceAmountMinor:'-1234',merchant:'Store',accountId:'account',accountLabel:null,status:'confirmed',sourceLabel:'manual',category:'Food',note:null,kind:'expense',revision:2,editRevision:3};
  let state={blocked:false,status:'ready'};
  const latest={...transaction,merchant:'Changed elsewhere',editRevision:4};
  const controller={snapshot:{current:()=>({data:{accounts:[{id:'account',displayName:'Bank',institution:null,currencies:['CAD']}]}})},mutation:{current:()=>state,submit:async()=>{state={blocked:false,status:'revision_conflict'};}},refreshTransaction:vi.fn(async()=>latest)};
  let tree:any;await act(async()=>{tree=create(React.createElement(TransactionEditor,{dark:false,transaction,controller,operationId:()=> 'operation_12345678',onClose:vi.fn(),onCategoryCleanup:async()=>true}));});
  act(()=>tree.root.findByProps({accessibilityLabel:'Description'}).props.onChangeText('Draft'));
  await act(async()=>{tree.root.findByProps({accessibilityLabel:'Save transaction'}).props.onPress();});
  expect(tree.root.findByProps({accessibilityLabel:'Save transaction'}).props.accessibilityState.disabled).toBe(true);
  act(()=>tree.root.findByProps({accessibilityLabel:'Refresh transaction'}).props.onPress());
  const actions=alerts.show.mock.calls.at(-1)![2];
  await act(async()=>{await actions.find((action:any)=>action.text==='Refresh').onPress();});
  expect(controller.refreshTransaction).toHaveBeenCalledWith('tx');
  expect(tree.root.findByProps({accessibilityLabel:'Description'}).props.value).toBe('Changed elsewhere');
  act(()=>tree.unmount());
 });

});
