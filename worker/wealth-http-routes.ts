import type { D1Database } from './db-types';
import type { FinancialContext } from './financial-authority';
import { apiSecurityHeaders, readJsonBody } from './security';
import { WealthDomainError } from '../src/domain/wealth';
import {
  listWealthQuoteCredentials,
  refreshWealthQuote,
  removeWealthQuoteCredential,
  saveWealthQuoteCredential,
  searchWealthQuote,
  type WealthQuoteInstrument,
} from './wealth-quotes';
import {
  appendWealthEvent,
  commitWealthImport,
  createWealthImportPreview,
  readWealthAccounts,
  readWealthEvents,
  readWealthInstruments,
  readWealthReport,
  readWealthSnapshot,
  readWealthValuations,
  upsertWealthAccount,
  upsertWealthInstrument,
  upsertWealthValuation,
  wealthExportCsv,
  WEALTH_CSV_TEMPLATE,
  WealthStoreError,
  type WealthAccountInput,
  type WealthInstrumentInput,
  type WealthReportDependencies,
  type WealthValuationInput,
} from './wealth-store';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

export interface WealthHttpEnv {
  WEALTH_CREDENTIAL_ENCRYPTION_KEY?: string;
  fetcher?: typeof fetch;
}

export interface WealthHttpRouteContext {
  readonly request: Request;
  readonly db: D1Database;
  readonly financialContext: FinancialContext;
  readonly root: string;
  readonly env?: WealthHttpEnv;
  readonly url: URL;
  readonly suffix: string;
}

interface WealthHttpRouteInput {
  readonly request: Request;
  readonly db: D1Database;
  readonly context: FinancialContext;
  readonly root: string;
  readonly env?: WealthHttpEnv;
}

type RouteHandler = (route: WealthHttpRouteContext) => Promise<Response>;
interface RouteDefinition {
  readonly method: string;
  readonly matches: (route: WealthHttpRouteContext) => boolean;
  readonly handle: RouteHandler;
}

export function json(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), { ...init, headers: { ...apiSecurityHeaders(), ...JSON_HEADERS, ...init.headers } });
}

function csv(value: string, filename: string): Response {
  return new Response(value, { status: 200, headers: { ...apiSecurityHeaders(), 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${filename}"` } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function bodyRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new WealthStoreError('invalid_request', 'The wealth request body is not valid.');
  return value as Record<string, unknown>;
}

function quoteSecret(env: WealthHttpEnv | undefined): string {
  if (!env?.WEALTH_CREDENTIAL_ENCRYPTION_KEY) throw new WealthStoreError('quote_not_configured', 'Wealth quote credentials are not configured.', 503, false);
  return env.WEALTH_CREDENTIAL_ENCRYPTION_KEY;
}

function pathId(value: string): string {
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded || decoded.length > 256) throw new Error('invalid');
    return decoded;
  } catch {
    throw new WealthStoreError('invalid_request', 'The wealth resource id is not valid.');
  }
}

function operationId(request: Request, body: Record<string, unknown>): string | undefined {
  return request.headers.get('idempotency-key')?.trim() || (typeof body.operationId === 'string' ? body.operationId : undefined);
}

function withOperationId(request: Request, body: Record<string, unknown>): Record<string, unknown> {
  const id = operationId(request, body);
  return id ? { ...body, operationId: id } : body;
}

function reportQuery(url: URL) {
  return {
    asOf: url.searchParams.get('asOf'),
    from: url.searchParams.get('from') ?? url.searchParams.get('periodStart'),
    to: url.searchParams.get('to') ?? url.searchParams.get('periodEnd'),
    currency: url.searchParams.get('currency'),
    reportingCurrency: url.searchParams.get('reportingCurrency'),
  };
}

function historyQuery(url: URL) {
  return { accountId: url.searchParams.get('accountId'), limit: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined };
}

function reportDependencies(route: WealthHttpRouteContext): WealthReportDependencies {
  return route.env?.fetcher ? { fetcher: route.env.fetcher } : {};
}

function suffixForPath(path: string, root: string): string | null {
  if (path === root) return '';
  if (!path.startsWith(`${root}/`)) return null;
  return path.slice(root.length);
}

function routeContext(input: WealthHttpRouteInput): WealthHttpRouteContext | null {
  const url = new URL(input.request.url);
  const suffix = suffixForPath(url.pathname, input.root);
  return suffix === null ? null : { request: input.request, db: input.db, financialContext: input.context, root: input.root, env: input.env, url, suffix };
}

async function handleCsvTemplate(): Promise<Response> {
  return csv(WEALTH_CSV_TEMPLATE, 'wealth-template.csv');
}

async function handleSnapshot(route: WealthHttpRouteContext): Promise<Response> {
  return json(await readWealthSnapshot(route.db, route.financialContext, reportQuery(route.url), reportDependencies(route)));
}

async function handleReport(route: WealthHttpRouteContext): Promise<Response> {
  return json(await readWealthReport(route.db, route.financialContext, reportQuery(route.url), reportDependencies(route)));
}

async function handleAccounts(route: WealthHttpRouteContext): Promise<Response> {
  return json(await readWealthAccounts(route.db, route.financialContext));
}

async function handleInstruments(route: WealthHttpRouteContext): Promise<Response> {
  return json(await readWealthInstruments(route.db, route.financialContext));
}

async function handleEvents(route: WealthHttpRouteContext): Promise<Response> {
  return json(await readWealthEvents(route.db, route.financialContext, historyQuery(route.url)));
}

async function handleValuations(route: WealthHttpRouteContext): Promise<Response> {
  return json(await readWealthValuations(route.db, route.financialContext, historyQuery(route.url)));
}

async function handleQuoteSettings(route: WealthHttpRouteContext): Promise<Response> {
  return json({ providers: await listWealthQuoteCredentials(route.db, route.financialContext) });
}

async function handleTemplate(route: WealthHttpRouteContext): Promise<Response> {
  return route.url.searchParams.get('format') === 'json' ? json({ csv: WEALTH_CSV_TEMPLATE }) : csv(WEALTH_CSV_TEMPLATE, 'wealth-template.csv');
}

async function handleExport(route: WealthHttpRouteContext): Promise<Response> {
  const value = await wealthExportCsv(route.db, route.financialContext);
  return route.url.searchParams.get('format') === 'json' ? json({ csv: value }) : csv(value, 'wealth-export.csv');
}

async function handleSaveQuoteSettings(route: WealthHttpRouteContext): Promise<Response> {
  const body = bodyRecord(await readJsonBody<unknown>(route.request, 16 * 1024));
  const credential = body.credential;
  if (typeof credential !== 'string') throw new WealthStoreError('invalid_request', 'The quote credential is required.');
  await saveWealthQuoteCredential(route.db, route.financialContext, { provider: body.provider as 'alpha_vantage' | undefined, credential }, { secret: quoteSecret(route.env) });
  return json({ configured: true, provider: body.provider ?? 'alpha_vantage' });
}

async function handleRemoveQuoteSettings(route: WealthHttpRouteContext): Promise<Response> {
  const provider = (route.url.searchParams.get('provider') as 'alpha_vantage' | null) ?? 'alpha_vantage';
  await removeWealthQuoteCredential(route.db, route.financialContext, provider);
  return json({ configured: false, provider: route.url.searchParams.get('provider') ?? 'alpha_vantage' });
}

async function handleQuoteSearch(route: WealthHttpRouteContext): Promise<Response> {
  const body = bodyRecord(await readJsonBody<unknown>(route.request, 32 * 1024));
  return json(await searchWealthQuote(route.db, route.financialContext, body.instrument as WealthQuoteInstrument, { secret: quoteSecret(route.env), fetcher: route.env?.fetcher }));
}

async function handleQuoteRefresh(route: WealthHttpRouteContext): Promise<Response> {
  const body = bodyRecord(await readJsonBody<unknown>(route.request, 32 * 1024));
  const providerSymbol = typeof body.providerSymbol === 'string' ? body.providerSymbol : undefined;
  return json(await refreshWealthQuote(route.db, route.financialContext, { instrument: body.instrument as WealthQuoteInstrument, providerSymbol }, { secret: quoteSecret(route.env), fetcher: route.env?.fetcher }));
}

function resourcePathId(route: WealthHttpRouteContext, pattern: RegExp): string | undefined {
  return route.suffix.match(pattern)?.[1];
}

async function handleAccountWrite(route: WealthHttpRouteContext): Promise<Response> {
  const body = bodyRecord(await readJsonBody<unknown>(route.request, 64 * 1024));
  const id = resourcePathId(route, /^\/accounts(?:\/([^/]+))?$/);
  if (id && body.id === undefined) body.id = pathId(id);
  return json(await upsertWealthAccount(route.db, route.financialContext, withOperationId(route.request, body) as WealthAccountInput), { status: 200 });
}

async function handleInstrumentWrite(route: WealthHttpRouteContext): Promise<Response> {
  const body = bodyRecord(await readJsonBody<unknown>(route.request, 32 * 1024));
  const id = resourcePathId(route, /^\/instruments(?:\/([^/]+))?$/);
  if (id && body.id === undefined) body.id = pathId(id);
  return json(await upsertWealthInstrument(route.db, route.financialContext, withOperationId(route.request, body) as unknown as WealthInstrumentInput), { status: 200 });
}

async function handleValuationWrite(route: WealthHttpRouteContext): Promise<Response> {
  const body = bodyRecord(await readJsonBody<unknown>(route.request, 32 * 1024));
  const id = resourcePathId(route, /^\/valuations(?:\/([^/]+))?$/);
  if (id && body.id === undefined) body.id = pathId(id);
  return json(await upsertWealthValuation(route.db, route.financialContext, withOperationId(route.request, body) as WealthValuationInput), { status: 200 });
}

async function handleEventWrite(route: WealthHttpRouteContext): Promise<Response> {
  const body = bodyRecord(await readJsonBody<unknown>(route.request, 128 * 1024));
  const event = body.event && typeof body.event === 'object' ? body.event : body;
  const expectedRevision = typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined;
  return json(await appendWealthEvent(route.db, route.financialContext, event, { expectedRevision, operationId: operationId(route.request, body) }), { status: 201 });
}

async function handleImportPreview(route: WealthHttpRouteContext): Promise<Response> {
  // JSON can encode each CSV byte as six bytes, plus bounded mapping/envelope overhead.
  const body = bodyRecord(await readJsonBody<unknown>(route.request, 6 * 2 * 1024 * 1024 + 256 * 1024));
  if (typeof body.csv !== 'string') throw new WealthStoreError('invalid_request', 'The CSV body is required.');
  return json(await createWealthImportPreview(route.db, route.financialContext, { csv: body.csv, mapping: body.mapping, operationId: operationId(route.request, body) }), { status: 201 });
}

function importRowIds(body: Record<string, unknown>): string[] | undefined {
  if (body.rowIds === undefined) return undefined;
  if (!Array.isArray(body.rowIds) || !body.rowIds.every((rowId) => typeof rowId === 'string')) throw new WealthStoreError('invalid_request', 'The import row ids are not valid.');
  return body.rowIds as string[];
}

async function handleImportCommit(route: WealthHttpRouteContext): Promise<Response> {
  const body = bodyRecord(await readJsonBody<unknown>(route.request, 64 * 1024));
  const expectedRevision = body.expectedRevision;
  if (!Number.isSafeInteger(expectedRevision)) throw new WealthStoreError('invalid_request', 'The expectedRevision is not valid.');
  const previewId = resourcePathId(route, /^\/imports\/([^/]+)\/commit$/)!;
  return json(await commitWealthImport(route.db, route.financialContext, pathId(previewId), { expectedRevision: expectedRevision as number, rowIds: importRowIds(body), operationId: operationId(route.request, body) }), { status: 200 });
}

const ROUTES: readonly RouteDefinition[] = [
  { method: 'GET', matches: (route) => route.suffix === '' && route.url.searchParams.get('view') === 'csv-template', handle: handleCsvTemplate },
  { method: 'GET', matches: (route) => route.suffix === '' || route.suffix === '/snapshot', handle: handleSnapshot },
  { method: 'GET', matches: (route) => route.suffix === '/report', handle: handleReport },
  { method: 'GET', matches: (route) => route.suffix === '/accounts', handle: handleAccounts },
  { method: 'GET', matches: (route) => route.suffix === '/instruments', handle: handleInstruments },
  { method: 'GET', matches: (route) => route.suffix === '/events', handle: handleEvents },
  { method: 'GET', matches: (route) => route.suffix === '/valuations', handle: handleValuations },
  { method: 'GET', matches: (route) => route.suffix === '/quotes/settings', handle: handleQuoteSettings },
  { method: 'GET', matches: (route) => route.suffix === '/template', handle: handleTemplate },
  { method: 'GET', matches: (route) => route.suffix === '/export', handle: handleExport },
  { method: 'PUT', matches: (route) => route.suffix === '/quotes/settings', handle: handleSaveQuoteSettings },
  { method: 'DELETE', matches: (route) => route.suffix === '/quotes/settings', handle: handleRemoveQuoteSettings },
  { method: 'POST', matches: (route) => route.suffix === '/quotes/search', handle: handleQuoteSearch },
  { method: 'POST', matches: (route) => route.suffix === '/quotes/refresh', handle: handleQuoteRefresh },
  { method: 'PUT', matches: (route) => /^\/accounts(?:\/([^/]+))?$/.test(route.suffix), handle: handleAccountWrite },
  { method: 'PUT', matches: (route) => /^\/instruments(?:\/([^/]+))?$/.test(route.suffix), handle: handleInstrumentWrite },
  { method: 'PUT', matches: (route) => /^\/valuations(?:\/([^/]+))?$/.test(route.suffix), handle: handleValuationWrite },
  { method: 'POST', matches: (route) => route.suffix === '/events', handle: handleEventWrite },
  { method: 'POST', matches: (route) => route.suffix === '/imports/preview', handle: handleImportPreview },
  { method: 'POST', matches: (route) => /^\/imports\/([^/]+)\/commit$/.test(route.suffix), handle: handleImportCommit },
];

export async function dispatchWealthRoute(input: WealthHttpRouteInput): Promise<Response | null> {
  const route = routeContext(input);
  if (!route) return null;
  const definition = ROUTES.find((candidate) => candidate.method === input.request.method && candidate.matches(route));
  return definition ? definition.handle(route) : json({ code: 'not_found', error: 'Not found' }, { status: 404 });
}

export function errorResponse(error: unknown): Response | null {
  if (error instanceof WealthStoreError) return json({ code: error.code, error: error.message, message: error.message, ...(error.currentRevision === undefined ? {} : { currentRevision: error.currentRevision }), retryable: error.retryable }, { status: error.status });
  if (error instanceof WealthDomainError) return json({ code: error.code, error: error.message, message: error.message, retryable: false }, { status: 400 });
  if (error instanceof RangeError) return json({ code: 'invalid_request', error: error.message, message: error.message, retryable: false }, { status: 400 });
  return null;
}
