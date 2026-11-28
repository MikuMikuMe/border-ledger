import type {AiProvider} from './ai-crypto';
import {listAiConfigurations,saveAiConfiguration,removeAiConfiguration,readAiSharing,setAiSharing,type AiConfiguration} from './ai-store';
import {previewAiAnalysis,runAiAnalysis} from './ai-analysis';
import {json,type Route} from './ai-http-common';
import {runReceiptAnalysis} from './receipt-ai';
import {readOcrConfiguration,removeOcrConfiguration,saveOcrConfiguration} from './receipt-ocr-settings';
import {runReceiptOcr} from './receipt-ocr-run';
type Selection=Parameters<typeof previewAiAnalysis>[2];
type Confirmation=Parameters<typeof runAiAnalysis>[2];
async function readOcrRoute(request:Request,path:string,route:Route):Promise<Response|null> {
  if(path!=='/ocr/configuration')return null;
  if(request.method==='GET')return json(await readOcrConfiguration(route.db,route.context));
  if(request.method==='DELETE'){await removeOcrConfiguration(route.db,route.context);return json({ok:true});}
  return null;
}
export async function readRoute(request:Request,path:string,route:Route):Promise<Response|null> {
  const {db,context}=route;
  const ocr=await readOcrRoute(request,path,route);if(ocr)return ocr;
  if(request.method==='GET' && path==='') return json({configurations:await listAiConfigurations(db,context),detailedTransactions:await readAiSharing(db,context)});
  if(request.method==='DELETE' && path.startsWith('/configuration/')) {await removeAiConfiguration(db,context,path.slice('/configuration/'.length) as AiProvider);return json({ok:true});}
  return null;
}
export async function putRoute(path:string,body:Record<string,unknown>,route:Route):Promise<Response|null> {
  const {db,context,env}=route;
  if(path==='/ocr/configuration'){await saveOcrConfiguration(db,context,body as unknown as Parameters<typeof saveOcrConfiguration>[2],{secret:env.secret,azure:{endpoint:env.azureEndpoint??'',key:env.azureKey??''}});return json({ok:true});}
  if(path==='/configuration') {await saveAiConfiguration(db,context,body as unknown as AiConfiguration,{secret:env.secret,appOrigin:env.origin,allowedHosts:env.allowedHosts});return json({ok:true});}
  if(path==='/sharing') {await setAiSharing(db,context,body.enabled as boolean);return json({ok:true});}
  return null;
}
export async function postRoute(path:string,body:Record<string,unknown>,route:Route):Promise<Response|null> {
  const {db,context,env}=route;
  if(path==='/ocr/scan')return json(await runReceiptOcr(db,context,body as unknown as Parameters<typeof runReceiptOcr>[2],env));
  if(path==='/receipt') return json(await runReceiptAnalysis(db,context,body as unknown as Parameters<typeof runReceiptAnalysis>[2],env));
  if(path==='/preview') return json(await previewAiAnalysis(db,context,body as unknown as Selection));
  if(path==='/run') return json({analysis:await runAiAnalysis(db,context,body as unknown as Confirmation,env)});
  return null;
}
