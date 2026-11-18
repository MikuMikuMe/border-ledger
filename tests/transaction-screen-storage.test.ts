import {describe,it,expect,vi} from 'vitest';
import {createRequire} from 'node:module';
import {createSqliteD1Fixture} from './helpers/sqlite-d1';
import {seedTenants,OWNER_LEDGER} from './helpers/tenants';
import {readMobileTransactionPage} from '../worker/mobile-transactions';
import {editTransaction,deleteTransaction,restoreTransaction,listDeletedTransactions} from '../worker/transaction-overrides';
import {report} from './fixtures/mobile-finance';

const require=createRequire(new URL('../mobile/package.json',import.meta.url));
const React=require('react'),{create,act}=require('react-test-renderer');
const mock=vi.hoisted(()=>({ledger:{} as any,session:{} as any,alert:vi.fn()}));
vi.mock('../mobile/node_modules/react-native/index.js',()=>({NativeModules:{},Alert:{alert:mock.alert},AppState:{addEventListener:()=>({remove(){}})},Text:'Text',View:'View',Pressable:'Pressable',TextInput:'TextInput',ActivityIndicator:'ActivityIndicator',Modal:'Modal',KeyboardAvoidingView:'KeyboardAvoidingView',ScrollView:'ScrollView',AccessibilityInfo:{setAccessibilityFocus:()=>{}},findNodeHandle:()=>null,StyleSheet:{create:(v:unknown)=>v}}));
vi.mock('../mobile/src/native/specs/NativeLedger',()=>({default:mock.ledger}));
vi.mock('../mobile/src/native/specs/NativeSession',()=>({default:mock.session}));
vi.mock('../mobile/src/native/specs/NativeRecurring',()=>({default:{onChanged:()=>({remove(){}})}}));
vi.mock('../mobile/src/native/specs/NativePreferences',()=>({default:{readReporting:async()=>({reportingTimezone:'UTC',weekStart:1,preferredCurrency:'CAD',revision:0,updatedAt:null})}}));
vi.mock('../mobile/src/native/specs/NativeReview',()=>({default:{}}));
vi.mock('../mobile/src/features/finance/ManualTransactions',()=>({ManualTransactions:()=>null}));
vi.mock('../mobile/src/features/finance/PlanPanel',()=>({PlanPanel:()=>null}));
const {FinanceScreen}=await import('../mobile/src/screens/FinanceScreen');
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);

const settle=()=>new Promise(resolve=>setTimeout(resolve,30));
function operation(id:string,action:string){return {operationId:id,kind:action,status:'completed',updatedAt:'2026-11-01',resultId:null};}

function installLedgerFixture(f:ReturnType<typeof createSqliteD1Fixture>){
  const read=async(query:any={})=>{
   const params=new URLSearchParams();for(const key of ['query','currency','status','source','category','cursor'])if(query[key])params.set(key,query[key]);
   const page=await readMobileTransactionPage(f.db,OWNER_LEDGER,params);
   return {items:page.items.map(row=>({id:row.id,occurredAt:row.date,currency:row.currency,signedMinorUnits:String(row.kind==='refund'?-Math.abs(row.amountMinor):Math.abs(row.amountMinor)),sourceAmountMinor:String(row.amountMinor),merchant:row.merchant,accountId:row.accountId,accountLabel:'Bank',status:row.status,sourceLabel:row.source,category:row.category,note:row.note,kind:row.kind,revision:row.revision,editRevision:row.editRevision})),nextCursor:page.page.nextCursor,limit:page.page.limit};
  };
  const snapshot=async()=>({schemaVersion:1,snapshotAt:'2026-11-01',timeZone:'UTC',accounts:[{id:'owner-account',displayName:'Bank',institution:'Bank',instrument:null,currencies:['CAD'],lastSuccessfulSyncAt:null}],transactions:(await read()).items,recurring:[],reviews:[],report});
  Object.assign(mock.ledger,{getSnapshot:snapshot,refreshSnapshot:snapshot,readTransactions:read,readReport:async()=>report,onChanged:()=>({remove(){}}),readCategories:async()=>'{"categories":[]}',readDeletedTransactions:async()=>JSON.stringify({items:await listDeletedTransactions(f.db,OWNER_LEDGER)}),startManualWrite:async(id:string,action:string,json:string)=>{
   const body=JSON.parse(json),target={id:body.transactionId,revision:body.expectedRevision,requestId:body.requestId};
   if(action==='edit')await editTransaction(f.db,OWNER_LEDGER,target,body);
   else if(action==='delete')await deleteTransaction(f.db,OWNER_LEDGER,target);
   else if(action==='restore')await restoreTransaction(f.db,OWNER_LEDGER,target);
   else throw new Error('Unexpected action');
   return operation(id,action);
  }});
  return read;
}

function ownerRows(tree:any){return tree.root.findAll((node:any)=>node.type==='Pressable'&&node.props.accessibilityLabel?.startsWith('Open activity: owner'));}
function showsEditedDate(tree:any){return tree.root.findAll((node:any)=>node.type==='Text').some((node:any)=>typeof node.props.children==='string'&&node.props.children.includes('2026-10-25'));}

describe('transaction screen and ledger integration',()=>{
 it('edits, deletes and restores a transaction through the real controller and storage',async()=>{
  const f=createSqliteD1Fixture();await seedTenants(f.db);
  await f.db.prepare("UPDATE transactions SET merchant='Other' WHERE id='owner-tx-2'").run();
  const read=installLedgerFixture(f);
  Object.assign(mock.session,{readOperations:async()=>[],queryOperation:async()=>null});mock.alert.mockClear();
  let tree:any;
  try{
   await act(async()=>{tree=create(React.createElement(FinanceScreen,{dark:false,destination:'activity'}));await settle();});
   const open=()=>ownerRows(tree)[0].props.onPress();
   await act(async()=>{open();await settle();});act(()=>tree.root.findByProps({accessibilityLabel:'Edit transaction'}).props.onPress());
   act(()=>tree.root.findByProps({accessibilityLabel:'Date (YYYY-MM-DD)'}).props.onChangeText('2026-10-25'));
   await act(async()=>{tree.root.findByProps({accessibilityLabel:'Save transaction'}).props.onPress();await settle();});
   expect((await read()).items.find(row=>row.id==='owner-tx-1')?.occurredAt).toBe('2026-10-25');
   await act(async()=>{open();await settle();});
   expect(showsEditedDate(tree)).toBe(true);
   act(()=>tree.root.findByProps({accessibilityLabel:'Delete transaction'}).props.onPress());
   await act(async()=>{mock.alert.mock.calls.at(-1)![2].find((item:any)=>item.text==='Delete').onPress();await settle();});
   expect((await read()).items.map(row=>row.id)).not.toContain('owner-tx-1');
   expect(ownerRows(tree)).toHaveLength(0);
   await act(async()=>{tree.root.findByProps({accessibilityLabel:'Recently deleted'}).props.onPress();await settle();});
   await act(async()=>{tree.root.findAll((node:any)=>node.type==='Pressable'&&node.props.accessibilityLabel?.startsWith('Restore owner,'))[0].props.onPress();await settle();});
   expect((await read()).items.find(row=>row.id==='owner-tx-1')).toMatchObject({occurredAt:'2026-10-25',editRevision:3});
   expect(ownerRows(tree)).toHaveLength(1);
  }finally{if(tree)act(()=>tree.unmount());f.close();}
 });
});
