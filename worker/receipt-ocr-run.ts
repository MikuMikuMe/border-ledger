import {parseReceipt,type ReceiptSuggestion} from '../src/domain/receipt';
import {reconcileReceiptTotal} from './receipt-reconcile';
import {openAiCredential} from './ai-crypto';
import type {AiEgressBinding} from './ai-egress';
import type {D1Database} from './db-types';
import {assertFinancialAuthority,type FinancialContext} from './financial-authority';
import {analyzeAzureReceipt} from './receipt-azure';
import {type StoredOcrConfiguration} from './receipt-ocr-settings';
import {analyzeVisionReceipt} from './receipt-vision';
import {decodeReceiptImage} from './receipt-ocr-image';
import {receiptAiCategories,receiptAiCategory} from './receipt-ai-category';

type Input={configurationRevision:string;image:string;contentType:string;text:string;confirmed:boolean};
type Environment={secret:string;origin:string;fetcher?:typeof fetch;egress?:AiEgressBinding;egressSecret?:string;azureEndpoint?:string;azureKey?:string};
async function configuration(db:D1Database,context:FinancialContext) {
  await assertFinancialAuthority(db,context,'ledger:read');
  return db.prepare('SELECT provider,endpoint,model,revision,ciphertext,iv FROM receipt_ocr_settings WHERE ledger_id=? AND user_id=?').bind(context.ledgerId,context.userId).first<StoredOcrConfiguration>();
}
function protectSuggestion(suggestion:ReceiptSuggestion,text:string) {
  const local=parseReceipt(text),result=reconcileReceiptTotal(suggestion,text);
  return {...result,suggestion:{...result.suggestion,currency:suggestion.currency===local.currency?local.currency:null}};
}
async function credentialFor(stored:StoredOcrConfiguration,context:FinancialContext,env:Environment) {
  const sharedAzure=stored.provider==='azure' && stored.ciphertext==='' && stored.iv==='';
  if(sharedAzure) {
    if(!env.azureKey || stored.endpoint!==env.azureEndpoint?.replace(/\/$/,''))throw new RangeError('Microsoft OCR settings changed; review again');
    return env.azureKey;
  }
  return openAiCredential(stored,env.secret,{userId:context.userId,ledgerId:context.ledgerId,provider:`receipt-${stored.provider}`});
}
async function authorizedConfiguration(db:D1Database,context:FinancialContext,revision:string,env:Environment) {
  const stored=await configuration(db,context);
  if(!stored || stored.revision!==revision)throw new RangeError('OCR settings changed; review again');
  const credential=await credentialFor(stored,context,env);
  const current=await configuration(db,context);
  if(!current || current.revision!==stored.revision)throw new RangeError('OCR settings changed; review again');
  return {stored,credential};
}
async function runVisionOcr(db:D1Database,context:FinancialContext,request:{stored:StoredOcrConfiguration;credential:string;input:Input;contentType:'image/jpeg'|'image/png'},env:Environment) {
  const {stored,credential,input,contentType}=request;
  const categories=await receiptAiCategories(db,context);
  const current=await configuration(db,context);
  if(!current || current.revision!==stored.revision)throw new RangeError('OCR settings changed; review again');
  const suggestion=await analyzeVisionReceipt({provider:stored.provider as 'openai'|'anthropic',endpoint:stored.endpoint,model:stored.model,credential,image:input.image,contentType,categories},env.fetcher ?? fetch);
  if(suggestion.category && !receiptAiCategory(suggestion.category,await receiptAiCategories(db,context)))delete suggestion.category;
  return {...protectSuggestion(suggestion,input.text),deletionRequested:null};
}
export async function runReceiptOcr(db:D1Database,context:FinancialContext,input:Input,env:Environment) {
  if(input.confirmed!==true)throw new RangeError('Confirm receipt sharing first');
  if(typeof input.text!=='string' || new TextEncoder().encode(input.text).length>12000)throw new RangeError('Invalid receipt text');
  const bytes=decodeReceiptImage(input),{stored,credential}=await authorizedConfiguration(db,context,input.configurationRevision,env);
  const contentType=input.contentType as 'image/jpeg'|'image/png';
  if(stored.provider==='azure') {
    const result=await analyzeAzureReceipt({endpoint:stored.endpoint,credential,image:bytes,contentType},env.fetcher);
    return {...result,...protectSuggestion(result.suggestion,input.text)};
  }
  return runVisionOcr(db,context,{stored,credential,input,contentType},env);
}
