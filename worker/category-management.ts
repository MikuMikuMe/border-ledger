import type {D1Database} from './db-types';
import {assertFinancialAuthority,financialAuthorityGuard,type FinancialContext} from './financial-authority';
import {categoryName,listCategories} from './category-store';
import {reviewStateGuard} from './review-publication';

const budgetTables=[
 {name:'allocations',table:'budget_allocations',keys:['month']},
 {name:'targets',table:'budget_targets',keys:[]},
 {name:'plans',table:'budget_tracking_plans',keys:['month','direction']},
 {name:'rollovers',table:'budget_rollover_policies',keys:['effective_month']},
] as const;
function validLegacyName(value:string) { return Boolean(value.trim()) && value.length<=120; }
function nameValue(value:unknown) {
 if(typeof value!=='string')throw new RangeError('Invalid category');
 if(!validLegacyName(value))throw new RangeError('Invalid category');
 return value;
}
async function rows(db:D1Database,context:FinancialContext,from:string,to:string) {
 const transactions=(await db.prepare(`SELECT t.id,t.category AS stored_category,t.note AS stored_note,COALESCE(a.category,t.category) AS category,CASE WHEN a.revision IS NULL THEN t.note ELSE a.note END AS note,COALESCE(a.revision,0) AS revision FROM transactions t LEFT JOIN annotation_revisions a ON a.id=(SELECT latest.id FROM annotation_revisions latest WHERE latest.ledger_id=t.ledger_id AND latest.transaction_id=t.id ORDER BY latest.revision DESC LIMIT 1) WHERE t.ledger_id=? AND COALESCE(a.category,t.category) IN (?,?) ORDER BY t.id`).bind(context.ledgerId,from,to).all<Record<string,unknown>>()).results;
 const budgets=await Promise.all(budgetTables.map(async item=>(await db.prepare(`SELECT * FROM ${item.table} WHERE ledger_id=? AND category IN (?,?) ORDER BY category${item.keys.map(key=>`,${key}`).join('')}`).bind(context.ledgerId,from,to).all<Record<string,unknown>>()).results));
 const categories=(await db.prepare('SELECT name,name_key,archived FROM categories WHERE ledger_id=? ORDER BY name_key').bind(context.ledgerId).all<Record<string,unknown>>()).results;
 const aliases=(await db.prepare('SELECT name,target FROM category_aliases WHERE ledger_id=? ORDER BY name').bind(context.ledgerId).all<Record<string,unknown>>()).results;
 return {transactions,budgets,categories,aliases};
}
function budgetConflict(rows:Record<string,unknown>[],keys:readonly string[],from:string,to:string) {
 return rows.some(left=>left.category===from&&rows.some(right=>right.category===to&&keys.every(key=>left[key]===right[key])));
}
async function digest(value:unknown) {
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
 return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
}
export async function previewCategoryCleanup(db:D1Database,context:FinancialContext,source:unknown,target:unknown) {
 const from=nameValue(source),to=categoryName(target);
 if(from===to)throw new RangeError('Choose a different category');
 await assertFinancialAuthority(db,context,'ledger:read');
 const categories=await listCategories(db,context);
 if(!categories.some(category=>category.name===from))throw new RangeError('Category not found');
 const snapshot=await rows(db,context,from,to);
 const budget=Object.fromEntries(budgetTables.map((table,index)=>[table.name,snapshot.budgets[index].filter(row=>row.category===from).length]));
 const conflicts=budgetTables.filter((table,index)=>budgetConflict(snapshot.budgets[index],table.keys,from,to)).map(table=>table.name);
 await assertFinancialAuthority(db,context,'ledger:read');
 return {from,to,transactions:snapshot.transactions.filter(row=>row.category===from).length,budget,conflicts,version:await digest({from,to,...snapshot})};
}
export async function archiveCategory(db:D1Database,context:FinancialContext,value:unknown) {
 const name=nameValue(value),categories=await listCategories(db,context);
 if(!categories.some(category=>category.name===name))throw new RangeError('Category not found');
 const result=await db.batch([financialAuthorityGuard(db,context,'ledger:review'),db.prepare(`INSERT INTO categories(ledger_id,name,name_key,archived) VALUES(?,?,?,1) ON CONFLICT(ledger_id,name_key) DO UPDATE SET archived=1 WHERE name=excluded.name`).bind(context.ledgerId,name,name.toLocaleLowerCase('und'))]);
 if(Number(result[1].meta?.changes??0)===0)throw new RangeError('Category already exists');
}

const transactionSnapshot=`SELECT t.id,t.category AS stored_category,t.note AS stored_note,COALESCE(a.category,t.category) AS category,CASE WHEN a.revision IS NULL THEN t.note ELSE a.note END AS note,COALESCE(a.revision,0) AS revision FROM transactions t LEFT JOIN annotation_revisions a ON a.id=(SELECT latest.id FROM annotation_revisions latest WHERE latest.ledger_id=t.ledger_id AND latest.transaction_id=t.id ORDER BY latest.revision DESC LIMIT 1) WHERE t.ledger_id=? AND COALESCE(a.category,t.category) IN (?,?) ORDER BY t.id`;
const fingerprintQueries=[
 `SELECT COALESCE(json_group_array(json_array(id,stored_category,stored_note,category,note,revision)),'[]') AS value FROM (${transactionSnapshot})`,
 `SELECT COALESCE(json_group_array(json_array(month,category,assigned_minor)),'[]') AS value FROM (SELECT * FROM budget_allocations WHERE ledger_id=? AND category IN (?,?) ORDER BY category,month)`,
 `SELECT COALESCE(json_group_array(json_array(category,target_minor)),'[]') AS value FROM (SELECT * FROM budget_targets WHERE ledger_id=? AND category IN (?,?) ORDER BY category)`,
 `SELECT COALESCE(json_group_array(json_array(month,direction,category,planned_minor)),'[]') AS value FROM (SELECT * FROM budget_tracking_plans WHERE ledger_id=? AND category IN (?,?) ORDER BY category,month,direction)`,
 `SELECT COALESCE(json_group_array(json_array(category,effective_month,policy)),'[]') AS value FROM (SELECT * FROM budget_rollover_policies WHERE ledger_id=? AND category IN (?,?) ORDER BY category,effective_month)`,
 `SELECT COALESCE(json_group_array(json_array(name,name_key,archived)),'[]') AS value FROM (SELECT * FROM categories WHERE ledger_id=? AND ? IS NOT NULL AND ? IS NOT NULL ORDER BY name_key)`,
 `SELECT COALESCE(json_group_array(json_array(name,target)),'[]') AS value FROM (SELECT * FROM category_aliases WHERE ledger_id=? AND ? IS NOT NULL AND ? IS NOT NULL ORDER BY name)`,
];
async function validateCleanup(db:D1Database,context:FinancialContext,{from,to,version}:{from:string;to:string;version:string}) {
 const preview=await previewCategoryCleanup(db,context,from,to);
 if(preview.version!==version||preview.conflicts.length)throw new Error('Category cleanup conflict: refresh preview');
 const categories=await listCategories(db,context),key=to.toLocaleLowerCase('und');
 const duplicates=categories.filter(c=>c.name!==from&&c.name!==to);
 if(duplicates.some(c=>c.name.toLocaleLowerCase('und')===key))throw new RangeError('Category already exists');
 return key;
}
export async function applyCategoryCleanup(db:D1Database,context:FinancialContext,input:{from:string;to:string;version:string}):Promise<void> {
 const from=nameValue(input.from),to=categoryName(input.to);
 await assertFinancialAuthority(db,context,'ledger:review');
 await assertFinancialAuthority(db,context,'preferences:write');
 const fingerprint=await Promise.all(fingerprintQueries.map(async query=>{
  const result=await db.prepare(query).bind(context.ledgerId,from,to).first<{value:string}>();
  return result!.value;
 }));
 const key=await validateCleanup(db,context,{from,to,version:input.version});
 const id=`category-cleanup-${crypto.randomUUID()}-`,author='subjectHash' in context?context.subjectHash:await digest(context.userId);
 const guards=fingerprintQueries.map((query,index)=>reviewStateGuard(db,context,`(${query})=?`,[context.ledgerId,from,to,fingerprint[index]]));
 const annotations=db.prepare(`INSERT INTO annotation_revisions(id,ledger_id,transaction_id,author_subject_hash,revision,category,note)
 SELECT ? || lower(hex(randomblob(16))),?,id,?,revision+1,?,note FROM (${transactionSnapshot}) WHERE category=?`)
 .bind(id,context.ledgerId,author,to,context.ledgerId,from,to,from);
 const projection=db.prepare(`UPDATE transactions SET category=?,note=(SELECT a.note FROM annotation_revisions a WHERE a.ledger_id=transactions.ledger_id AND a.transaction_id=transactions.id ORDER BY a.revision DESC LIMIT 1),updated_at=CURRENT_TIMESTAMP WHERE ledger_id=? AND id IN (SELECT transaction_id FROM annotation_revisions WHERE ledger_id=? AND substr(id,1,?)=?)`)
 .bind(to,context.ledgerId,context.ledgerId,id.length,id);
 const budgetUpdates=budgetTables.map(table=>db.prepare(`UPDATE ${table.table} SET category=? WHERE ledger_id=? AND category=?`).bind(to,context.ledgerId,from));
 const target=db.prepare(`INSERT INTO categories(ledger_id,name,name_key,archived) VALUES(?,?,?,0) ON CONFLICT(ledger_id,name_key) DO UPDATE SET name=excluded.name,archived=0`).bind(context.ledgerId,to,key);
 const old=db.prepare(`INSERT INTO categories(ledger_id,name,name_key,archived) SELECT ?,?,?,1 WHERE ?<>? ON CONFLICT(ledger_id,name_key) DO UPDATE SET archived=1 WHERE name=excluded.name`).bind(context.ledgerId,from,from.toLocaleLowerCase('und'),from.toLocaleLowerCase('und'),key);
 const clearTarget=db.prepare('DELETE FROM category_aliases WHERE ledger_id=? AND name=?').bind(context.ledgerId,to);
 const redirects=db.prepare('UPDATE category_aliases SET target=? WHERE ledger_id=? AND target=? AND name<>?').bind(to,context.ledgerId,from,to);
 const alias=db.prepare('INSERT INTO category_aliases(ledger_id,name,target) VALUES(?,?,?) ON CONFLICT(ledger_id,name) DO UPDATE SET target=excluded.target').bind(context.ledgerId,from,to);
 await db.batch([financialAuthorityGuard(db,context,'ledger:review'),financialAuthorityGuard(db,context,'preferences:write'),...guards,clearTarget,annotations,projection,...budgetUpdates,target,old,redirects,alias]);
}

export async function restoreCategory(db:D1Database,context:FinancialContext,value:unknown):Promise<void> {
 const name=nameValue(value);
 const allowed=`EXISTS(SELECT 1 FROM categories WHERE ledger_id=? AND name=? AND archived=1) AND NOT EXISTS(SELECT 1 FROM category_aliases WHERE ledger_id=? AND name=?)`;
 await db.batch([financialAuthorityGuard(db,context,'ledger:review'),reviewStateGuard(db,context,allowed,[context.ledgerId,name,context.ledgerId,name]),db.prepare('UPDATE categories SET archived=0 WHERE ledger_id=? AND name=?').bind(context.ledgerId,name)]);
}
