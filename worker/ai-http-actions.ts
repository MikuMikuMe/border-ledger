import type {AiProvider} from './ai-crypto';
import {listAiConfigurations,saveAiConfiguration,removeAiConfiguration,readAiSharing,setAiSharing,type AiConfiguration} from './ai-store';
import {previewAiAnalysis,runAiAnalysis} from './ai-analysis';
import {json,type Route} from './ai-http-common';
type Selection=Parameters<typeof previewAiAnalysis>[2];
type Confirmation=Parameters<typeof runAiAnalysis>[2];
export async function readRoute(request:Request,path:string,route:Route):Promise<Response|null> {
  const {db,context}=route;
  if(request.method==='GET' && path==='') return json({configurations:await listAiConfigurations(db,context),detailedTransactions:await readAiSharing(db,context)});
  if(request.method==='DELETE' && path.startsWith('/configuration/')) {await removeAiConfiguration(db,context,path.slice('/configuration/'.length) as AiProvider);return json({ok:true});}
  return null;
}
export async function putRoute(path:string,body:Record<string,unknown>,route:Route):Promise<Response|null> {
  const {db,context,env}=route;
  if(path==='/configuration') {await saveAiConfiguration(db,context,body as unknown as AiConfiguration,{secret:env.secret,appOrigin:env.origin,allowedHosts:env.allowedHosts});return json({ok:true});}
  if(path==='/sharing') {await setAiSharing(db,context,body.enabled as boolean);return json({ok:true});}
  return null;
}
export async function postRoute(path:string,body:Record<string,unknown>,route:Route):Promise<Response|null> {
  const {db,context,env}=route;
  if(path==='/preview') return json(await previewAiAnalysis(db,context,body as unknown as Selection));
  if(path==='/run') return json({analysis:await runAiAnalysis(db,context,body as unknown as Confirmation,env)});
  return null;
}
