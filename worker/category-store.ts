import type {D1Database} from './db-types';
import {assertFinancialAuthority,financialAuthorityGuard,type FinancialContext} from './financial-authority';

function validCategoryName(name:string) { return Boolean(name) && name.length<=80 && !/[\u0000-\u001f\u007f]/.test(name); }
export function categoryName(value:unknown) {
 if(typeof value!=='string')throw new RangeError('Invalid category name');
 const name=value.trim();
 if(!validCategoryName(name))throw new RangeError('Invalid category name');
 return name;
}
export async function listCategories(db:D1Database,context:FinancialContext) {
 await assertFinancialAuthority(db,context,'ledger:read');
 const result=await db.prepare(`SELECT name,archived FROM categories WHERE ledger_id=?
 UNION SELECT category AS name,0 AS archived FROM transactions WHERE ledger_id=? AND category NOT IN (SELECT name FROM categories WHERE ledger_id=?)
 UNION SELECT a.category AS name,0 AS archived FROM annotation_revisions a WHERE a.ledger_id=? AND a.revision=(SELECT MAX(latest.revision) FROM annotation_revisions latest WHERE latest.ledger_id=a.ledger_id AND latest.transaction_id=a.transaction_id) AND a.category NOT IN (SELECT name FROM categories WHERE ledger_id=?)
 UNION SELECT category AS name,0 AS archived FROM budget_allocations WHERE ledger_id=? AND category NOT IN (SELECT name FROM categories WHERE ledger_id=?)
 UNION SELECT category AS name,0 AS archived FROM budget_targets WHERE ledger_id=? AND category NOT IN (SELECT name FROM categories WHERE ledger_id=?)
 UNION SELECT category AS name,0 AS archived FROM budget_tracking_plans WHERE ledger_id=? AND category NOT IN (SELECT name FROM categories WHERE ledger_id=?)
 UNION SELECT category AS name,0 AS archived FROM budget_rollover_policies WHERE ledger_id=? AND category NOT IN (SELECT name FROM categories WHERE ledger_id=?) ORDER BY name`).bind(...Array(13).fill(context.ledgerId)).all<{name:string;archived:number}>();
 await assertFinancialAuthority(db,context,'ledger:read');
 return result.results.map(row=>({name:row.name,archived:!!row.archived}));
}
export async function createCategory(db:D1Database,context:FinancialContext,value:unknown) {
 const name=categoryName(value), key=name.toLocaleLowerCase('und');
 const existing=await listCategories(db,context);
 if(existing.some(row=>row.name.trim().toLocaleLowerCase('und')===key))throw new RangeError('Category already exists');
 const result=await db.batch([financialAuthorityGuard(db,context,'ledger:review'),db.prepare('INSERT INTO categories(ledger_id,name,name_key) VALUES(?,?,?) ON CONFLICT(ledger_id,name_key) DO NOTHING').bind(context.ledgerId,name,key)]);
 if(Number(result[1].meta?.changes??0)===0)throw new RangeError('Category already exists');
}
