import {validateHost} from './ai-endpoint-host';
function validateUrlParts(url:URL):void {
  if(url.protocol!=='https:') throw new RangeError('Invalid provider endpoint');
  if([url.username,url.password,url.port,url.search,url.hash].some(Boolean)) throw new RangeError('Invalid provider endpoint');
}
function parseEndpoint(input:string):URL {
  if(typeof input!=='string' || input.length>2048) throw new RangeError('Invalid provider endpoint');
  try {return new URL(input);} catch {throw new RangeError('Invalid provider endpoint');}
}
function applicationHost(appOrigin:string):string {
  try {return new URL(appOrigin).hostname.toLowerCase().replace(/\.$/,'');}
  catch {throw new Error('Application origin is not configured');}
}
export function validateAiEndpoint(input:string,appOrigin:string,allowedHosts=''):string {
  const url=parseEndpoint(input);
  validateUrlParts(url);
  const host=url.hostname.toLowerCase().replace(/\.$/,'');
  validateHost(host);
  if(host===applicationHost(appOrigin)) throw new RangeError('Invalid provider endpoint');
  const trusted=new Set(['api.openai.com','api.anthropic.com',...allowedHosts.split(',').map(value=>value.trim().toLowerCase()).filter(Boolean)]);
  if(!trusted.has(host)) throw new RangeError('Provider endpoint is not approved by the server');
  return url.toString();
}
