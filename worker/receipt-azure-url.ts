export const azureVersion='2024-11-30';
export const azureReceiptModel='/documentintelligence/documentModels/prebuilt-receipt';

function parseUrl(value:unknown) {
  if(typeof value!=='string' || value.length>2048)throw new RangeError('Invalid Microsoft endpoint');
  try {return new URL(value);}catch {throw new RangeError('Invalid Microsoft endpoint');}
}
export function azureReceiptEndpoint(input:string) {
  const url=parseUrl(input);
  if(url.protocol!=='https:' || url.href!==`${url.origin}/`)throw new RangeError('Invalid Microsoft endpoint');
  if(!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cognitiveservices\.azure\.com$/i.test(url.hostname))throw new RangeError('Invalid Microsoft endpoint');
  return url.origin;
}
export function azureOperationUrl(value:string|null,origin:string) {
  const url=parseUrl(value),prefix=`${azureReceiptModel}/analyzeResults/`;
  const id=url.pathname.slice(prefix.length);
  if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id))throw new Error('Microsoft did not return a valid result location');
  const expected=`${origin}${prefix}${id}?api-version=${azureVersion}`;
  if(url.href!==expected)throw new Error('Microsoft did not return a valid result location');
  return expected;
}
