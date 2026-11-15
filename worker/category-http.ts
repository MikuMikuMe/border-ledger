import type {D1Database} from './db-types';
import type {FinancialContext} from './financial-authority';
import {listCategories,createCategory} from './category-store';
import {archiveCategory,restoreCategory,previewCategoryCleanup,applyCategoryCleanup} from './category-management';
import {isReviewStateConflict} from './review-publication';
import {budgetJson as json} from './budget-http-common';
import {readJsonBody} from './security';

function isRecord(value:unknown):value is Record<string,unknown> { return value!==null && typeof value==='object' && !Array.isArray(value); }
async function bodyRecord(request:Request) {
 const body=await readJsonBody<unknown>(request,4096);
 if(!isRecord(body))throw new RangeError('Invalid request body');
 return body;
}
type PostContext={db:D1Database;context:FinancialContext;body:Record<string,unknown>};
async function cleanupRequest({db,context,body}:PostContext) {
 if(typeof body.from!=='string')throw new RangeError('Invalid cleanup source');
 if(typeof body.to!=='string')throw new RangeError('Invalid cleanup target');
 if(typeof body.version!=='string'||!/^[a-f0-9]{64}$/.test(body.version))throw new RangeError('Invalid cleanup version');
 await applyCategoryCleanup(db,context,{from:body.from,to:body.to,version:body.version});return json({ok:true});
}
const postHandlers:Record<string,(input:PostContext)=>Promise<Response>>={
 '':async({db,context,body})=>{await createCategory(db,context,body.name);return json({ok:true},201);},
 archive:async({db,context,body})=>{await archiveCategory(db,context,body.name);return json({ok:true});},
 restore:async({db,context,body})=>{await restoreCategory(db,context,body.name);return json({ok:true});},
 preview:async({db,context,body})=>json(await previewCategoryCleanup(db,context,body.from,body.to)),
 cleanup:cleanupRequest,
};
async function categoryPost(request:Request,db:D1Database,context:FinancialContext,path:string) {
 const handler=postHandlers[path];
 if(!handler)return json({code:'not_found',message:'Not found'},404);
 return handler({db,context,body:await bodyRecord(request)});
}
function categoryError(error:unknown) {
 if(error instanceof RangeError)return json({code:'invalid_request',message:error.message},400);
 if(isReviewStateConflict(error))return json({code:'category_conflict',message:'Categories changed or budgets conflict. Refresh the preview.'},409);
 if(error instanceof Error&&error.message.startsWith('Category cleanup conflict'))return json({code:'category_conflict',message:'Categories changed or budgets conflict. Refresh the preview.'},409);
 throw error;
}
export async function handleCategoryApi(request:Request,db:D1Database,context:FinancialContext,root:string):Promise<Response|null> {
 const path=new URL(request.url).pathname;
 if(path!==root&&!path.startsWith(`${root}/`))return null;
 try {
  if(request.method==='GET'&&path===root)return json({categories:await listCategories(db,context)});
  if(request.method==='POST')return await categoryPost(request,db,context,path.slice(root.length+1));
  return json({code:'not_found',message:'Not found'},404);
 } catch(error) {
  return categoryError(error);
 }
}
