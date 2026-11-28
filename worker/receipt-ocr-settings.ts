import {sealAiCredential} from './ai-crypto';
import {containsCredential} from './ai-secret-scrub';
import {validateProviderEndpoint} from './ai-endpoint';
import type {D1Database} from './db-types';
import {assertFinancialAuthority,financialAuthorityPredicate,type FinancialContext} from './financial-authority';
import {azureReceiptEndpoint} from './receipt-azure';

export type OcrProvider='azure'|'openai'|'anthropic';
type Input={provider:OcrProvider;endpoint:string;model:string;credential:string};
type PublicConfiguration={provider:OcrProvider;endpoint:string;model:string;revision:string};
export type StoredOcrConfiguration=PublicConfiguration & {ciphertext:string;iv:string};
function validateEndpoint(provider:OcrProvider,input:string) {
  if(provider==='azure')return azureReceiptEndpoint(input);
  validateProviderEndpoint(provider,input);
  return input;
}
export async function readOcrConfiguration(db:D1Database,context:FinancialContext):Promise<PublicConfiguration|null> {
  await assertFinancialAuthority(db,context,'ledger:read');
  return db.prepare('SELECT provider,endpoint,model,revision FROM receipt_ocr_settings WHERE ledger_id=? AND user_id=?').bind(context.ledgerId,context.userId).first<PublicConfiguration>();
}
function validateModel(input:Input) {
  if(typeof input.model!=='string')throw new RangeError('Invalid OCR model');
  if(input.provider==='azure') {if(input.model!=='')throw new RangeError('Invalid OCR model');return;}
  if(!/^[\w.\-:/]{1,160}$/.test(input.model))throw new RangeError('Invalid OCR model');
}
function validateCredential(credential:unknown):asserts credential is string {
  if(typeof credential!=='string')throw new RangeError('Invalid OCR key');
  if(!credential || credential.trim()!==credential)throw new RangeError('Invalid OCR key');
}
function validInput(input:Input) {
  if(!['azure','openai','anthropic'].includes(input.provider))throw new RangeError('Invalid OCR provider');
  validateCredential(input.credential);
  validateModel(input);
  const endpoint=validateEndpoint(input.provider,input.endpoint);
  if(containsCredential(endpoint,input.credential) || containsCredential(input.model,input.credential))throw new RangeError('Keep the OCR key out of other settings');
  return endpoint;
}
type SaveOptions=string|{secret:string;azure:{endpoint:string;key:string}};
function prepareSharedAzure(input:Input,azure:{endpoint:string;key:string}) {
  if(!azure.key)throw new RangeError('Microsoft OCR is not configured');
  if([input.endpoint,input.credential,input.model].some(Boolean))throw new RangeError('Invalid Microsoft OCR configuration');
  return {endpoint:azureReceiptEndpoint(azure.endpoint),sealed:{ciphertext:'',iv:''}};
}
async function prepareConfiguration(input:Input,context:FinancialContext,options:SaveOptions) {
  if(input.provider==='azure' && typeof options!=='string')return prepareSharedAzure(input,options.azure);
  const secret=typeof options==='string'?options:options.secret;
  return {endpoint:validInput(input),sealed:await sealAiCredential(input.credential,secret,{userId:context.userId,ledgerId:context.ledgerId,provider:`receipt-${input.provider}`})};
}
export async function saveOcrConfiguration(db:D1Database,context:FinancialContext,input:Input,options:SaveOptions) {
  const {endpoint,sealed}=await prepareConfiguration(input,context,options);
  const authority=financialAuthorityPredicate(context,'preferences:write');
  const result=await db.prepare(`INSERT INTO receipt_ocr_settings(ledger_id,user_id,provider,endpoint,model,ciphertext,iv,revision) SELECT ?,?,?,?,?,?,?,? WHERE ${authority.sql}
    ON CONFLICT(ledger_id,user_id) DO UPDATE SET provider=excluded.provider,endpoint=excluded.endpoint,model=excluded.model,ciphertext=excluded.ciphertext,iv=excluded.iv,revision=excluded.revision WHERE ${authority.sql}`)
    .bind(context.ledgerId,context.userId,input.provider,endpoint,input.model,sealed.ciphertext,sealed.iv,crypto.randomUUID(),...authority.bindings,...authority.bindings).run();
  if(result.meta?.changes!==1)throw new Error('OCR settings authority invalid');
}
export async function removeOcrConfiguration(db:D1Database,context:FinancialContext) {
  await assertFinancialAuthority(db,context,'preferences:write');
  const authority=financialAuthorityPredicate(context,'preferences:write');
  await db.prepare(`DELETE FROM receipt_ocr_settings WHERE ledger_id=? AND user_id=? AND ${authority.sql}`).bind(context.ledgerId,context.userId,...authority.bindings).run();
}
