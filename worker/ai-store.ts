import {containsCredential} from './ai-secret-scrub';
import type {D1Database} from './db-types';
import {financialAuthorityPredicate,type FinancialContext} from './financial-authority';
import {sealAiCredential,type AiProvider} from './ai-crypto';
import {validateAiEndpoint} from './ai-provider';
export interface AiConfiguration {provider:AiProvider;endpoint:string;model:string;credential:string}
function validateProvider(provider:unknown):asserts provider is AiProvider {
  if(provider!=='openai' && provider!=='anthropic') throw new RangeError('Invalid provider');
}
export async function listAiConfigurations(db:D1Database,context:FinancialContext) {
  const authority=financialAuthorityPredicate(context,'ledger:read');
  const rows=await db.prepare(`SELECT provider,endpoint,model,revision FROM ai_credentials WHERE ledger_id=? AND user_id=? AND ${authority.sql} ORDER BY provider`).bind(context.ledgerId,context.userId,...authority.bindings).all<{provider:AiProvider;endpoint:string;model:string;revision:string}>();
  return rows.results;
}
interface ConfigurationOptions {secret:string;appOrigin:string;allowedHosts?:string}
function validateModel(model:unknown):void {
  if(typeof model!=='string' || !/^[\w.\-:/]{1,160}$/.test(model)) throw new RangeError('Invalid provider model');
}
function validateCredential(credential:unknown):asserts credential is string {
  if(typeof credential!=='string' || credential.trim()!==credential) throw new RangeError('Invalid provider credential');
}
function validateConfiguration(input:AiConfiguration,options:ConfigurationOptions):string {
  validateProvider(input.provider);
  validateModel(input.model);
  validateCredential(input.credential);
  const endpoint=validateAiEndpoint(input.endpoint,options.appOrigin,options.allowedHosts);
  if(containsCredential(endpoint,input.credential) || containsCredential(input.model,input.credential)) throw new RangeError('Keep the provider key out of the endpoint');
  return endpoint;
}
export async function saveAiConfiguration(db:D1Database,context:FinancialContext,input:AiConfiguration,options:ConfigurationOptions) {
  const endpoint=validateConfiguration(input,options);
  const sealed=await sealAiCredential(input.credential,options.secret,{userId:context.userId,ledgerId:context.ledgerId,provider:input.provider});
  const authority=financialAuthorityPredicate(context,'preferences:write');
  const result=await db.prepare(`INSERT INTO ai_credentials(ledger_id,user_id,provider,endpoint,model,ciphertext,iv,revision) SELECT ?,?,?,?,?,?,?,? WHERE ${authority.sql}
    ON CONFLICT(ledger_id,user_id,provider) DO UPDATE SET endpoint=excluded.endpoint,model=excluded.model,ciphertext=excluded.ciphertext,iv=excluded.iv,revision=excluded.revision WHERE ${authority.sql}`)
    .bind(context.ledgerId,context.userId,input.provider,endpoint,input.model,sealed.ciphertext,sealed.iv,crypto.randomUUID(),...authority.bindings,...authority.bindings).run();
  if(result.meta?.changes!==1) throw new Error('AI settings authority invalid');
}
export async function removeAiConfiguration(db:D1Database,context:FinancialContext,provider:AiProvider) {
  validateProvider(provider);
  const authority=financialAuthorityPredicate(context,'preferences:write');
  await db.prepare(`DELETE FROM ai_credentials WHERE ledger_id=? AND user_id=? AND provider=? AND ${authority.sql}`).bind(context.ledgerId,context.userId,provider,...authority.bindings).run();
}
export async function readAiSharing(db:D1Database,context:FinancialContext):Promise<boolean> {
  const authority=financialAuthorityPredicate(context,'ledger:read');
  const row=await db.prepare(`SELECT detailed_transactions FROM ai_sharing_settings WHERE ledger_id=? AND user_id=? AND ${authority.sql}`).bind(context.ledgerId,context.userId,...authority.bindings).first<{detailed_transactions:number}>();
  return row?.detailed_transactions===1;
}
export async function setAiSharing(db:D1Database,context:FinancialContext,enabled:boolean) {
  if(typeof enabled!=='boolean') throw new RangeError('Invalid sharing setting');
  const authority=financialAuthorityPredicate(context,'preferences:write');
  const result=await db.prepare(`INSERT INTO ai_sharing_settings(ledger_id,user_id,detailed_transactions) SELECT ?,?,? WHERE ${authority.sql}
    ON CONFLICT(ledger_id,user_id) DO UPDATE SET detailed_transactions=excluded.detailed_transactions,revision=ai_sharing_settings.revision+1 WHERE ${authority.sql}`)
    .bind(context.ledgerId,context.userId,enabled?1:0,...authority.bindings,...authority.bindings).run();
  if(result.meta?.changes!==1) throw new Error('AI settings authority invalid');
}
