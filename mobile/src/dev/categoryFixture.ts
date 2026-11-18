import type {CategoryServices} from '../features/finance/categoryServices';
import {report,transaction} from './financeFixtures';
export const categoryFixture:CategoryServices={
 readCategories:async()=>JSON.stringify({categories:[{name:'Food',archived:false},{name:'Groceries',archived:false},{name:'Transport',archived:false}]}),
 createCategory:async()=>JSON.stringify({ok:true}),
 categoryAction:async(action,body)=>{const input=JSON.parse(body);return JSON.stringify(action==='preview'?{from:input.from,to:input.to,transactions:2,budget:{allocations:1},conflicts:[],version:'a'.repeat(64)}:{ok:true});},
 readReport:async()=>report,
 readTransactions:async()=>({items:[{...transaction,editRevision:transaction.editRevision??null,sourceAmountMinor:transaction.sourceAmountMinor??null}],nextCursor:null,limit:50}),
};
