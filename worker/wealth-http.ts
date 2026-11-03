import type { D1Database } from './db-types';
import type { FinancialContext } from './financial-authority';
import { dispatchWealthRoute, errorResponse, type WealthHttpEnv } from './wealth-http-routes';

export type { WealthHttpEnv } from './wealth-http-routes';

export interface WealthHttpOptions {
  readonly root?: string;
  readonly env?: WealthHttpEnv;
}

export async function handleWealthApi(request: Request, db: D1Database, context: FinancialContext, options: WealthHttpOptions = {}): Promise<Response | null> {
  const root = options.root ?? '/api/wealth';
  const path = new URL(request.url).pathname;
  if (path !== root && !path.startsWith(`${root}/`)) return null;
  try {
    return await dispatchWealthRoute({ request, db, context, root, env: options.env });
  } catch (error) {
    const response = errorResponse(error);
    if (response) return response;
    throw error;
  }
}
