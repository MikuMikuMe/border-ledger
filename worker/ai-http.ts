import {AiProviderError} from './ai-provider';
import {readJsonBody} from './security';
import {readRoute,putRoute,postRoute} from './ai-http-actions';
import {json,type Route} from './ai-http-common';
function record(value:unknown):Record<string,unknown> {
  if(!value) throw new RangeError('Invalid request body');
  if(typeof value!=='object') throw new RangeError('Invalid request body');
  if(Array.isArray(value)) throw new RangeError('Invalid request body');
  return value as Record<string,unknown>;
}
async function dispatch(request:Request,route:Route) {
  const path=new URL(request.url).pathname.slice(route.root.length);
  const read=await readRoute(request,path,route);
  if(read) return read;
  if(request.method!=='PUT' && request.method!=='POST') return json({code:'not_found',message:'Not found'},404);
  const body=record(await readJsonBody(request,16384));
  const result=request.method==='PUT'?await putRoute(path,body,route):await postRoute(path,body,route);
  return result ?? json({code:'not_found',message:'Not found'},404);
}
export async function handleAiApi(request:Request,route:Route):Promise<Response|null> {
  const path=new URL(request.url).pathname;
  if(path!==route.root && !path.startsWith(route.root+'/')) return null;
  try {return await dispatch(request,route);}
  catch(error) {if(error instanceof AiProviderError) return json({code:'provider_error',message:error.message,error:error.message},error.status);if(error instanceof RangeError) return json({code:'invalid_request',message:error.message,error:error.message},400);throw error;}
}
