const encoder=new TextEncoder();
function bytes(hex:string):Uint8Array<ArrayBuffer> {
  if(!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('Gateway authentication unavailable');
  return Uint8Array.from(hex.match(/../g)!,part=>parseInt(part,16));
}
async function key(secret:string):Promise<CryptoKey> {
  return crypto.subtle.importKey('raw',bytes(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
function message(timestamp:string,body:string):Uint8Array<ArrayBuffer> {return encoder.encode(timestamp+'\n'+body);}
export async function signGatewayBody(secret:string,timestamp:string,body:string):Promise<string> {
  const signature=await crypto.subtle.sign('HMAC',await key(secret),message(timestamp,body));
  return Array.from(new Uint8Array(signature),value=>value.toString(16).padStart(2,'0')).join('');
}
export async function verifyGatewayBody(secret:string,request:{timestamp:string;body:string;signature:string},now:number):Promise<boolean> {
  const {timestamp,body,signature}=request;
  if(!/^\d{13}$/.test(timestamp) || Math.abs(now-Number(timestamp))>30000) return false;
  try {return await crypto.subtle.verify('HMAC',await key(secret),bytes(signature),message(timestamp,body));}
  catch {return false;}
}
