import { LunchFlowError, boundedJson, parseTransactions, parseLunchFlowBalance, type LunchFlowAccount } from './lunchflow';
import { getCurrencyMeta } from '../src/domain/currencies';

export interface LunchFlowPlatformEnv {
  LUNCHFLOW_CLIENT_ID?: string;
  LUNCHFLOW_CLIENT_SECRET?: string;
  LUNCHFLOW_REDIRECT_URI?: string;
  LEDGER_APP_ORIGIN?: string;
}
export interface PlatformTokens {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
  user_id: string;
}
export interface PlatformAccount extends LunchFlowAccount { bankConnectionId: string }
const OAUTH_BASE = 'https://www.lunchflow.app/api/platform/oauth';
const RESOURCE_BASE = 'https://www.lunchflow.app/api/platform/v1';

function validRedirect(redirect: URL, origin: URL) {
  if (redirect.protocol !== 'https:') return false;
  if (redirect.origin !== origin.origin) return false;
  if (redirect.pathname !== '/api/lunchflow/oauth/callback') return false;
  return [redirect.search,redirect.hash,redirect.username,redirect.password].every(value=>value==='');
}
export function platformConfiguration(env: LunchFlowPlatformEnv) {
  if (!env.LUNCHFLOW_CLIENT_ID?.trim()) return null;
  if (!env.LUNCHFLOW_CLIENT_SECRET?.trim()) return null;
  try {
    const redirect = new URL(env.LUNCHFLOW_REDIRECT_URI ?? '');
    const origin = new URL(env.LEDGER_APP_ORIGIN?.split(',')[0] ?? '');
    if (!validRedirect(redirect,origin)) return null;
    return { clientId:env.LUNCHFLOW_CLIENT_ID, clientSecret:env.LUNCHFLOW_CLIENT_SECRET, redirectUri:redirect.href };
  } catch { return null; }
}
export function requirePlatformConfiguration(env: LunchFlowPlatformEnv) {
  const config = platformConfiguration(env);
  if (!config) throw new LunchFlowError('configuration_required','Lunch Flow authorization is not configured.',503);
  return config;
}
export class PlatformRequestError extends LunchFlowError {
  constructor(public readonly uncertain: boolean, status: number) {
    super('provider_rejected','Lunch Flow could not complete this request.',status,uncertain);
  }
}
function invalid(): never { throw new LunchFlowError('malformed_response','Lunch Flow returned an invalid response.'); }
function record(value: unknown): Record<string,unknown> {
  if (!value) return invalid();
  if (typeof value !== 'object') return invalid();
  if (Array.isArray(value)) return invalid();
  return value as Record<string,unknown>;
}
function text(value: unknown, max = 4096): string {
  if (typeof value !== 'string') return invalid();
  if (!value.trim()) return invalid();
  if (value.length > max) return invalid();
  return value;
}
function numericId(value: unknown): string {
  if (typeof value !== 'number') return invalid();
  if (!Number.isSafeInteger(value)) return invalid();
  if (value < 0) return invalid();
  return String(value);
}
function tokenLifetime(value: unknown) {
  if(typeof value !== 'number') return invalid();
  if(!Number.isFinite(value)) return invalid();
  if(value<=0 || value>604800) return invalid();
  return value;
}
export function parsePlatformTokens(value: unknown): PlatformTokens {
  const row=record(value);
  if(row.token_type !== 'Bearer') return invalid();
  const expiresIn=tokenLifetime(row.expires_in);
  return {access_token:text(row.access_token,16384),refresh_token:text(row.refresh_token,16384),token_type:'Bearer',expires_in:expiresIn,user_id:text(row.user_id,256)};
}
function parseAccount(value: unknown): PlatformAccount {
  const row=record(value);
  const id=numericId(row.id), bankConnectionId=numericId(row.connection_id);
  text(row.provider,64);
  if(row.institution_logo !== null) text(row.institution_logo,4096);
  const currency=typeof row.currency === 'string' ? getCurrencyMeta(row.currency.toUpperCase())?.code ?? null : null;
  const status=typeof row.status === 'string' ? text(row.status,64) : 'UNKNOWN';
  return {id,bankConnectionId,name:text(row.name,256),institutionName:text(row.institution_name,256),currency,status};
}
function parseAccounts(value: unknown) {
  const row=record(value);
  if(!Array.isArray(row.accounts)) return invalid();
  if(row.accounts.length > 25) return invalid();
  if(row.total !== row.accounts.length) return invalid();
  const accounts=row.accounts.map(parseAccount);
  if(new Set(accounts.map(account=>account.id)).size !== accounts.length) return invalid();
  return accounts;
}
async function request(fetcher: typeof fetch, url: string, init: RequestInit, empty = false): Promise<unknown> {
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),15000);
  try {
    const response=await fetcher(url,{...init,redirect:'manual',signal:controller.signal});
    if(empty && (response.status===204 || response.status===404)) { await response.body?.cancel(); return undefined; }
    if(!response.ok) { await response.body?.cancel(); throw new PlatformRequestError(response.status>=500, response.status===429?503:502); }
    return await boundedJson(response,8*1024*1024);
  } catch(error) {
    if(error instanceof LunchFlowError) throw error;
    throw new PlatformRequestError(true,503);
  } finally { clearTimeout(timeout); }
}
export function createLunchFlowPlatform(env: LunchFlowPlatformEnv, fetcher: typeof fetch = fetch) {
  const config=requirePlatformConfiguration(env);
  async function token(body: Record<string,string>) {
    return parsePlatformTokens(await request(fetcher,`${OAUTH_BASE}/token`,{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({...body,client_id:config.clientId,client_secret:config.clientSecret})}));
  }
  function data(accessToken: string, path: string) {
    return request(fetcher,`${RESOURCE_BASE}${path}`,{method:'GET',headers:{authorization:`Bearer ${accessToken}`,accept:'application/json'}});
  }
  return {
    authorize(state: string) { const url=new URL(`${OAUTH_BASE}/authorize`); url.search=new URLSearchParams({client_id:config.clientId,redirect_uri:config.redirectUri,state}).toString(); return url.href; },
    exchange: (code: string)=>token({grant_type:'authorization_code',code,redirect_uri:config.redirectUri}),
    refresh: (refreshToken: string)=>token({grant_type:'refresh_token',refresh_token:refreshToken}),
    getBalance: async(accessToken: string,accountId: string)=>parseLunchFlowBalance(await data(accessToken,`/accounts/${encodeURIComponent(accountId)}/balance`)),
    listAccounts: async(accessToken: string)=>parseAccounts(await data(accessToken,'/accounts')),
    listTransactions: async(accessToken: string,accountId: string)=>parseTransactions(await data(accessToken,`/accounts/${encodeURIComponent(accountId)}/transactions?include_pending=true`),accountId),
    async revoke(userId: string) { await request(fetcher,`${RESOURCE_BASE}/users/${encodeURIComponent(userId)}`,{method:'DELETE',headers:{authorization:`Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`}},true); },
  };
}
