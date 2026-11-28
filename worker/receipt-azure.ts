import type {ReceiptSuggestion} from '../src/domain/receipt';
import {azureReceiptFields,record} from './receipt-azure-fields';
import {azureOperationUrl,azureReceiptEndpoint,azureReceiptModel,azureVersion} from './receipt-azure-url';
export {azureReceiptEndpoint} from './receipt-azure-url';

type AzureInput={endpoint:string;credential:string;image:Uint8Array;contentType:'image/jpeg'|'image/png'};
type AzureResult={suggestion:ReceiptSuggestion;deletionRequested:boolean};
async function boundedJson(response:Response) {
  if(!response.body)throw new Error('Microsoft returned an empty response');
  const reader=response.body.getReader(),decoder=new TextDecoder();let text='',size=0;
  try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1048576)throw new Error('Microsoft response exceeded limit');text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}
  finally {await reader.cancel().catch(()=>{});}
  try {return JSON.parse(text) as unknown;} catch {throw new Error('Microsoft returned an invalid response');}
}
async function fetchMicrosoft(fetcher:typeof fetch,url:string,method:string,credential:string,body?:Uint8Array,contentType?:string) {
  const headers=new Headers({'Ocp-Apim-Subscription-Key':credential});if(contentType)headers.set('content-type',contentType);
  return fetcher(url,{method,headers,body:body as BodyInit|undefined,redirect:'manual',signal:AbortSignal.timeout(5000)});
}
function retryDelay(response:Response) {
  const value=response.headers.get('retry-after');
  return value && /^\d+$/.test(value)?Math.max(2000,Number(value)*1000):2000;
}
export async function analyzeAzureReceipt(input:AzureInput,fetcher:typeof fetch=fetch,wait:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms))):Promise<AzureResult> {
  const origin=azureReceiptEndpoint(input.endpoint);
  if(!input.credential || input.credential.length>4096 || !['image/jpeg','image/png'].includes(input.contentType) || input.image.byteLength===0 || input.image.byteLength>6*1024*1024)throw new RangeError('Invalid receipt image');
  const response=await fetchMicrosoft(fetcher,`${origin}${azureReceiptModel}:analyze?api-version=${azureVersion}`,'POST',input.credential,input.image,input.contentType);
  if(response.status!==202)throw new Error('Microsoft receipt analysis is unavailable');
  const operation=azureOperationUrl(response.headers.get('operation-location'),origin);
  const deadline=Date.now()+18000;
  let deletionRequested=false,suggestion:ReceiptSuggestion|undefined;
  try {
    let delay=retryDelay(response);
    for(let attempt=0;attempt<9;attempt++) {
      if(delay>deadline-Date.now())break;
      await wait(delay);
      const status=await fetchMicrosoft(fetcher,operation,'GET',input.credential);
      if(status.status===429){delay=retryDelay(status);continue;}
      if(!status.ok)throw new Error('Microsoft receipt analysis is unavailable');
      const data=await boundedJson(status),state=record(data).status;
      if(state==='succeeded'){suggestion=azureReceiptFields(data);break;}
      if(state!=='running' && state!=='notStarted')throw new Error('Microsoft receipt analysis failed');
      delay=retryDelay(status);
    }
    if(!suggestion)throw new Error('Microsoft receipt analysis timed out');
  } finally {
    try {deletionRequested=(await fetchMicrosoft(fetcher,operation,'DELETE',input.credential)).status===204;} catch {/* Microsoft retains data according to its documented policy. */}
  }
  return {suggestion,deletionRequested};
}
