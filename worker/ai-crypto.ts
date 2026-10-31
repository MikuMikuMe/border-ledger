export type AiProvider = 'openai' | 'anthropic';
export interface AiCredentialBinding { userId:string; ledgerId:string; provider:AiProvider }
export interface SealedAiCredential { ciphertext:string; iv:string }
const encoder=new TextEncoder();
function encode(bytes:Uint8Array) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,''); }
function decode(value:string) { return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)); }
function associatedData(binding:AiCredentialBinding) { return encoder.encode(JSON.stringify(['ai-credential-v1',binding.userId,binding.ledgerId,binding.provider])); }
async function encryptionKey(secret:string,usage:KeyUsage) {
  if(!/^[0-9a-f]{64}$/i.test(secret)) throw new Error('AI credential encryption is not configured');
  const bytes=Uint8Array.from(secret.match(/../g)!,part=>parseInt(part,16));
  return crypto.subtle.importKey('raw',bytes,'AES-GCM',false,[usage]);
}
export async function sealAiCredential(credential:string,secret:string,binding:AiCredentialBinding):Promise<SealedAiCredential> {
  if(!credential || credential.length>4096) throw new RangeError('Invalid provider credential');
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:associatedData(binding)},await encryptionKey(secret,'encrypt'),encoder.encode(credential));
  return {iv:encode(iv),ciphertext:encode(new Uint8Array(ciphertext))};
}
export async function openAiCredential(sealed:SealedAiCredential,secret:string,binding:AiCredentialBinding):Promise<string> {
  try {
    const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(sealed.iv),additionalData:associatedData(binding)},await encryptionKey(secret,'decrypt'),decode(sealed.ciphertext));
    return new TextDecoder().decode(plaintext);
  } catch { throw new Error('AI credentials could not be opened'); }
}
