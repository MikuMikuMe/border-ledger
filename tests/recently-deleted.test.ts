import {describe,it,expect,vi} from 'vitest';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../mobile/package.json',import.meta.url));
const React=require('react'),{create,act}=require('react-test-renderer');
vi.mock('../mobile/node_modules/react-native/index.js',()=>({NativeModules:{},Text:'Text',View:'View',Pressable:'Pressable',TextInput:'TextInput',ActivityIndicator:'ActivityIndicator',Modal:'Modal',KeyboardAvoidingView:'KeyboardAvoidingView',ScrollView:'ScrollView',AccessibilityInfo:{setAccessibilityFocus:()=>{}},findNodeHandle:()=>null,StyleSheet:{create:(v:unknown)=>v}}));
const api=vi.hoisted(()=>({read:vi.fn(async()=>JSON.stringify({items:[{id:'tx',merchant:'Shop',date:'2026-10-25',accountName:'Bank',amountMinor:-1234,currency:'CAD',deletedAt:'2026-11-01',revision:2}]})),write:vi.fn(async()=>({status:'completed'}))}));
vi.mock('../mobile/src/native/specs/NativeLedger',()=>({default:{readDeletedTransactions:api.read,startManualWrite:api.write}}));
vi.mock('../mobile/src/native/specs/NativeSession',()=>({default:{queryOperation:vi.fn()}}));
const {RecentlyDeleted}=await import('../mobile/src/features/finance/RecentlyDeleted');
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
describe('recently deleted',()=>{
 it('loads and restores a transaction through the operation journal',async()=>{
  const controller={mutation:{current:()=>({blocked:false,status:'completed'}),submit:async(_:string,write:()=>Promise<unknown>)=>write()},reload:vi.fn()};let tree:any;
  await act(async()=>{tree=create(React.createElement(RecentlyDeleted,{dark:false,controller,operationId:()=> 'operation_12345678'}));});
  await act(async()=>{tree.root.findByProps({accessibilityLabel:'Recently deleted'}).props.onPress();await Promise.resolve();});
  const text=JSON.stringify(tree.toJSON());expect(text).toContain('2026-10-25');expect(text).toContain('Bank');expect(text).toContain('2026-11-01');
  await act(async()=>{tree.root.findAll((node:any)=>node.type==='Pressable'&&node.props.accessibilityLabel?.startsWith('Restore Shop,'))[0].props.onPress();await Promise.resolve();});
  const [id,action,body]=api.write.mock.calls[0] as unknown as [string,string,string];
  expect(id).toBe('operation_12345678');expect(action).toBe('restore');expect(JSON.parse(body)).toMatchObject({transactionId:'tx',expectedRevision:2,requestId:id});
  expect(controller.reload).toHaveBeenCalled();expect(api.read).toHaveBeenCalledTimes(2);act(()=>tree.unmount());
 });
 it('shows an error instead of crashing on a malformed recovery response',async()=>{
  api.read.mockResolvedValueOnce(JSON.stringify({items:[{id:'tx',merchant:'Shop',deletedAt:null,amountMinor:'not-a-number'}]}));
  const controller={mutation:{current:()=>({blocked:false,status:'ready'})}};let tree:any;
  await act(async()=>{tree=create(React.createElement(RecentlyDeleted,{dark:false,controller,operationId:()=> 'operation_12345678'}));});
  await act(async()=>{tree.root.findByProps({accessibilityLabel:'Recently deleted'}).props.onPress();await Promise.resolve();});
  expect(JSON.stringify(tree.toJSON())).toContain('Could not load deleted transactions.');act(()=>tree.unmount());
 });

});
