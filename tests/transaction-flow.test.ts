import {describe,it,expect,vi} from 'vitest';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../mobile/package.json',import.meta.url));
const React=require('react'),{create,act}=require('react-test-renderer');
const mocks=vi.hoisted(()=>({alert:vi.fn(),write:vi.fn(async()=>({status:'completed'})),readDeleted:vi.fn(async()=>JSON.stringify({items:[{id:'tx',merchant:'Store',date:'2026-10-25',accountName:'Bank',amountMinor:-1234,currency:'CAD',deletedAt:'2026-11-01',revision:1}]})),controller:null as any}));
vi.mock('../mobile/node_modules/react-native/index.js',()=>({NativeModules:{},Alert:{alert:mocks.alert},AppState:{addEventListener:()=>({remove(){}})},Text:'Text',View:'View',Pressable:'Pressable',TextInput:'TextInput',ActivityIndicator:'ActivityIndicator',Modal:'Modal',KeyboardAvoidingView:'KeyboardAvoidingView',ScrollView:'ScrollView',AccessibilityInfo:{setAccessibilityFocus:()=>{}},findNodeHandle:()=>null,StyleSheet:{create:(v:unknown)=>v}}));
vi.mock('../mobile/src/native/specs/NativeLedger',()=>({default:{startManualWrite:mocks.write,readDeletedTransactions:mocks.readDeleted,readCategories:async()=>'{"categories":[]}'}}));
vi.mock('../mobile/src/native/specs/NativeSession',()=>({default:{queryOperation:vi.fn()}}));
vi.mock('../mobile/src/native/specs/NativeRecurring',()=>({default:{}}));
vi.mock('../mobile/src/native/specs/NativePreferences',()=>({default:{}}));
vi.mock('../mobile/src/native/specs/NativeReview',()=>({default:{}}));
vi.mock('../mobile/src/features/finance/ManualTransactions',()=>({ManualTransactions:()=>null}));
vi.mock('../mobile/src/features/finance/PlanPanel',()=>({PlanPanel:()=>null}));
vi.mock('../mobile/src/features/finance/FinanceController',()=>({FinanceController:class {constructor(){return mocks.controller;}}}));
const {FinanceScreen}=await import('../mobile/src/screens/FinanceScreen');
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
const transaction={id:'tx',occurredAt:'2026-10-25',currency:'CAD',signedMinorUnits:'1234',sourceAmountMinor:'-1234',merchant:'Store',accountId:'account',accountLabel:'Bank',status:'confirmed',sourceLabel:'manual',category:'Food',note:null,kind:'expense',revision:0,editRevision:0};
function controller(){
 const ready=(data:unknown)=>({phase:'ready',message:null,data});
 return {snapshot:{current:()=>ready({accounts:[{id:'account',displayName:'Bank',institution:null,currencies:['CAD']}],transactions:[transaction]})},report:{current:()=>ready({currencyTotals:[]})},activity:{current:()=>ready({items:[transaction],nextCursor:null,limit:50})},activityFacetRows:[transaction],activityFilters:{},mutation:{current:()=>({blocked:false,status:'completed'}),submit:async(_:string,write:()=>Promise<unknown>)=>write()},start:vi.fn(),dispose:vi.fn(),recover:vi.fn(),reload:vi.fn(),loadActivity:vi.fn()};
}
function open(tree:any){const row=tree.root.findAll((node:any)=>node.type==='Pressable'&&node.props.accessibilityLabel?.startsWith('Open activity: Store'))[0];act(()=>row.props.onPress());}
describe('Android transaction flow',()=>{
 it('opens the full editor, confirms deletion and restores the entry',async()=>{
  mocks.controller=controller();mocks.write.mockClear();mocks.alert.mockClear();let tree:any;
  await act(async()=>{tree=create(React.createElement(FinanceScreen,{dark:false,destination:'activity'}));});
  open(tree);act(()=>tree.root.findByProps({accessibilityLabel:'Edit transaction'}).props.onPress());
  expect(tree.root.findByProps({accessibilityLabel:'Date (YYYY-MM-DD)'}).props.value).toBe('2026-10-25');
  act(()=>tree.root.findByProps({accessibilityLabel:'Date (YYYY-MM-DD)'}).props.onChangeText('2026-10-26'));
  await act(async()=>{tree.root.findByProps({accessibilityLabel:'Save transaction'}).props.onPress();await Promise.resolve();await Promise.resolve();});
  const [,edit,editBody]=mocks.write.mock.calls[0] as unknown as [string,string,string];
  expect(edit).toBe('edit');expect(JSON.parse(editBody)).toMatchObject({transactionId:'tx',date:'2026-10-26',expectedRevision:0});
  open(tree);act(()=>tree.root.findByProps({accessibilityLabel:'Delete transaction'}).props.onPress());
  expect(mocks.write).toHaveBeenCalledTimes(1);
  const actions=mocks.alert.mock.calls.at(-1)![2];
  await act(async()=>{actions.find((action:any)=>action.text==='Delete').onPress();await Promise.resolve();await Promise.resolve();});
  const [,action,body]=mocks.write.mock.calls[1] as unknown as [string,string,string];
  expect(action).toBe('delete');expect(JSON.parse(body)).toMatchObject({transactionId:'tx',expectedRevision:0});expect(mocks.controller.reload).toHaveBeenCalled();
  await act(async()=>{tree.root.findByProps({accessibilityLabel:'Recently deleted'}).props.onPress();await Promise.resolve();});
  await act(async()=>{tree.root.findAll((node:any)=>node.type==='Pressable'&&node.props.accessibilityLabel?.startsWith('Restore Store,'))[0].props.onPress();await Promise.resolve();await Promise.resolve();});
  const [,restore,restoreBody]=mocks.write.mock.calls[2] as unknown as [string,string,string];
  expect(restore).toBe('restore');expect(JSON.parse(restoreBody)).toMatchObject({transactionId:'tx',expectedRevision:1});
  act(()=>tree.unmount());
 });
});
