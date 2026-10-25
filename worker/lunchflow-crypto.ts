import { LunchFlowError } from './lunchflow';
import { parsePlatformTokens, type PlatformTokens } from './lunchflow-platform';
export interface CredentialBinding { userId:string; ledgerId:string; connectionId:string; version:number }
export interface CredentialProtection { secret:string; binding:CredentialBinding }
export interface SealedLunchFlowTokens { ciphertext:string; iv:string }
function encode(bytes:Uint8Array) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,''); }
function decode(value:string) { return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),char=>char.charCodeAt(0)); }
export function lunchFlowEncryptionKey(value?:string) {
  try {
    if(!value || !/^[0-9a-f]{64}$/i.test(value)) throw new Error();
    return Uint8Array.from(value.match(/../g)!,part=>Number.parseInt(part,16));
  }catch{throw new LunchFlowError('configuration_required','Lunch Flow token encryption requires a 32-byte hexadecimal key.',503);}
}
function aad(binding:CredentialBinding) { return new TextEncoder().encode(JSON.stringify(['lunchflow-tokens-v1',binding.userId,binding.ledgerId,binding.connectionId,binding.version])); }
async function key(value:string,usage:KeyUsage) { return crypto.subtle.importKey('raw',lunchFlowEncryptionKey(value),'AES-GCM',false,[usage]); }
export async function sealLunchFlowTokens(tokens:PlatformTokens,protection:CredentialProtection):Promise<SealedLunchFlowTokens> {
  const {secret,binding}=protection;
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(binding)},await key(secret,'encrypt'),new TextEncoder().encode(JSON.stringify(tokens)));
  return {ciphertext:encode(new Uint8Array(ciphertext)),iv:encode(iv)};
}
export async function openLunchFlowTokens(sealed:SealedLunchFlowTokens,protection:CredentialProtection) {
  const {secret,binding}=protection;
  try {
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(sealed.iv),additionalData:aad(binding)},await key(secret,'decrypt'),decode(sealed.ciphertext));
    return parsePlatformTokens(JSON.parse(new TextDecoder().decode(plain)));
  }catch{throw new LunchFlowError('credential_invalid','Lunch Flow credentials require reconnection.',409);}
}
export async function lunchFlowHash(value:string) {
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
export function lunchFlowNonce() { return encode(crypto.getRandomValues(new Uint8Array(32))); }
