import {redactCredential} from './ai-secret-scrub';
import type {AiProvider} from './ai-crypto';
async function boundedText(response:Response):Promise<string> {
  if(!response.body) return '';
  const reader=response.body.getReader(); const decoder=new TextDecoder(); let text=''; let size=0;
  try {while(true) {const {done,value}=await reader.read(); if(done) return text+decoder.decode(); size+=value.byteLength; if(size>262144) throw new Error('Provider response was too large'); text+=decoder.decode(value,{stream:true});}} finally {await reader.cancel().catch(()=>{});}
}
function responseChoices(value:unknown,provider:AiProvider):unknown[] {
  if(!value || typeof value!=='object') throw new Error('Provider returned an invalid response');
  const object=value as Record<string,unknown>;
  const choices=provider==='anthropic'?object.content:object.choices;
  if(!Array.isArray(choices)) throw new Error('Provider returned an invalid response');
  return choices;
}
function resultText(value:unknown,provider:AiProvider):string {
  const choices=responseChoices(value,provider) as Array<{type?:string;text?:unknown;message?:{content?:unknown}}>;
  const text=provider==='anthropic'?choices.filter(item=>item.type==='text' && typeof item.text==='string').map(item=>item.text).join('\n'):choices[0]?.message?.content;
  if(typeof text!=='string' || !text.trim()) throw new Error('Provider returned an empty response');
  return text;
}
function providerCutShort(value:unknown,provider:AiProvider):boolean {
  if(!value || typeof value!=='object') return false;
  const response=value as {stop_reason?:unknown;choices?:Array<{finish_reason?:unknown}>};
  if(provider==='anthropic') return response.stop_reason==='max_tokens' || response.stop_reason==='model_context_window_exceeded';
  return response.choices?.[0]?.finish_reason==='length';
}
export async function parseProviderResponse(response:Response,provider:AiProvider,credential:string):Promise<string> {
  let parsed:unknown;
  try {parsed=JSON.parse(await boundedText(response));} catch {throw new Error('Provider returned an invalid response');}
  const text=redactCredential(resultText(parsed,provider),credential);
  const shortened=text.slice(0,32000);
  return providerCutShort(parsed,provider) || text.length>shortened.length?shortened+'\n\n[This analysis is incomplete because an output limit was reached.]':shortened;
}