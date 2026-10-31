import { readPlanOccurrences } from './recurring-plan-projection';
import type { D1Database } from './db-types';
import type { LedgerContext } from './tenant-context';
import { apiSecurityHeaders, readJsonBody } from './security';
import { createPlan, listPlans, PlanConflictError, updatePlan, type PlanInput } from './recurring-plans';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...apiSecurityHeaders(), 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
function object(value: unknown): Record<string, unknown> {
  if (!value) throw new RangeError('Invalid request body');
  if (typeof value !== 'object') throw new RangeError('Invalid request body');
  if (Array.isArray(value)) throw new RangeError('Invalid request body');
  return value as Record<string, unknown>;
}
async function today(db: D1Database, context: LedgerContext): Promise<string> {
  const pref = await db.prepare('SELECT reporting_timezone FROM ledger_preferences WHERE ledger_id=?').bind(context.ledgerId).first<{reporting_timezone:string}>();
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: pref?.reporting_timezone ?? 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (name: string) => parts.find(part => part.type === name)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
async function listPlanResponse(db: D1Database, context: LedgerContext) {
  const [plans, currencies] = await Promise.all([listPlans(db, context), db.prepare('SELECT account_id AS accountId,currency FROM account_currencies WHERE ledger_id=? ORDER BY account_id,currency').bind(context.ledgerId).all()]);
  return json({ plans, accountCurrencies: currencies.results });
}
async function occurrenceResponse(db: D1Database, context: LedgerContext, url: URL) {
  const from = url.searchParams.get('from'), to = url.searchParams.get('to');
  if (!from || !to) throw new RangeError('from and to are required');
  return json({ occurrences: await readPlanOccurrences(db, context, {from, to, today: await today(db, context)}) });
}
async function createPlanResponse(request: Request, db: D1Database, context: LedgerContext) {
  const body = object(await readJsonBody(request, 16384));
  const plan = object(body.plan) as unknown as PlanInput;
  return json(await createPlan(db, context, body.operationId as string, plan), 201);
}
async function updatePlanResponse(request: Request, db: D1Database, context: LedgerContext, id: string) {
  const body = object(await readJsonBody(request, 16384));
  return json(await updatePlan(db, context, {id, revision:body.expectedRevision as number, value:object(body.plan) as unknown as PlanInput & {enabled:boolean}}));
}
async function dispatchPlanRequest(request: Request, db: D1Database, context: LedgerContext, root: string) {
  const url = new URL(request.url);
  if (request.method === 'GET') {
    if (url.pathname === root) return listPlanResponse(db, context);
    if (url.pathname === `${root}/occurrences`) return occurrenceResponse(db, context, url);
  }
  if (request.method === 'POST' && url.pathname === root) return createPlanResponse(request, db, context);
  const match = url.pathname.match(new RegExp(`^${root}/([0-9a-f-]{36})$`, 'i'));
  if (request.method === 'PATCH' && match) return updatePlanResponse(request, db, context, match[1]);
  return json({ error: 'Not found', code: 'not_found', message: 'Not found' }, 404);
}
export async function handlePlanApi(request: Request, db: D1Database, context: LedgerContext, root: string): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== root && !url.pathname.startsWith(`${root}/`)) return null;
  try {
    return await dispatchPlanRequest(request, db, context, root);
  } catch (error) {
    if (error instanceof RangeError) return json({ error: error.message, code: 'invalid_request', message: error.message }, 400);
    if (error instanceof PlanConflictError) return json({ error: error.message, code: 'revision_conflict', message: error.message, ...(error.currentRevision === undefined ? {} : {currentRevision:error.currentRevision}) }, 409);
    throw error;
  }
}
