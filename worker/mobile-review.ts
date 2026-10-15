import { reportingDateForInstant } from '../src/domain/alert-lifecycle';
import { getCurrencyMeta } from '../src/domain/currencies';
import { appendAnnotationRevision } from './annotation-store';
import type { D1Database, D1Statement } from './db-types';
import {
  applyAlertReview,
  ReconciliationConflictError,
  ReconciliationReviewError,
} from './reconciliation-store';

const LEDGER_ID = 'personal' as const;
const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 100;
const MAX_CURSOR_LENGTH = 512;
const MAX_ID_LENGTH = 128;
const MAX_CATEGORY_LENGTH = 80;
const MAX_NOTE_LENGTH = 1000;
const MAX_REASON_CODES = 8;
const MAX_PROVENANCE_PER_ALERT = 8;
const MAX_CANDIDATES_PER_ALERT = 5;
const MAX_LINKS_PER_ALERT = 8;
const ALERT_REVIEW_DECISIONS = ['keep_separate', 'ignore', 'link', 'classify'] as const;
const ALERT_REVIEW_RELATIONS = ['cancels', 'partially_reverses', 'replaces_authorization', 'refund_of', 'confirms', 'possible_duplicate'] as const;
const LIFECYCLE_RELATIONS = new Set(['cancels', 'partially_reverses', 'replaces_authorization']);

type AlertReviewDecision = typeof ALERT_REVIEW_DECISIONS[number];
type AlertReviewRelation = typeof ALERT_REVIEW_RELATIONS[number];

interface AlertCursor {
  createdAt: string;
  eventId: string;
}

interface AlertProjectionRow {
  id: string;
  event_id: string;
  transaction_id: string | null;
  state: string;
  revision: number;
  updated_at: string;
  reason_codes_json: string;
  counted_currency?: string | null;
  counted_amount_minor?: number | null;
}

interface AlertPageRow extends AlertProjectionRow {
  event_type: string;
  event_time_basis: string;
  notification_posted_at: string | null;
  captured_at: string;
  source_profile_id: string;
  parser_version: string;
  bank_reference: string | null;
  merchant: string | null;
  account_id: string | null;
  direction: string;
  event_money_currency: string | null;
  event_money_amount_minor: number | null;
  transaction_date: string | null;
  created_at: string;
}

interface ProvenanceRow {
  projection_id: string;
  source_kind: string;
  source_id: string;
  basis: string;
  revision: number;
}

interface CandidatePageRow {
  id: string;
  statement_transaction_id: string;
  candidate_transaction_id: string;
  score: number;
  reason_codes_json: string;
  evidence_basis: string;
  status: string;
  target_id: string;
  target_account_id: string;
  target_date: string;
  target_merchant: string;
  target_amount_minor: number;
  target_currency: string;
  target_kind: string;
  target_status: string;
  target_source: string;
}

interface AnnotationPageRow {
  transaction_id: string;
  transaction_category: string | null;
  annotation_revision: number | null;
  annotation_category: string | null;
  annotation_note: string | null;
}

interface LinkPageRow {
  id: string;
  from_event_id: string;
  to_event_id: string | null;
  to_transaction_id: string | null;
  relation: string;
  allocated_currency: string | null;
  allocated_amount_minor: number | null;
  evidence_basis: string;
  revision: number;
}

interface AnnotationRow {
  id: string;
  ledger_id: string;
  transaction_id: string;
  revision: number;
  created_at: string;
}

export class MobileReviewError extends Error {
  readonly code: string;
  readonly status: number;
  readonly currentRevision?: number;

  constructor(code: string, message: string, status = 400, currentRevision?: number) {
    super(message);
    this.name = 'MobileReviewError';
    this.code = code;
    this.status = status;
    this.currentRevision = currentRevision;
  }
}

function invalid(message: string): never {
  throw new MobileReviewError('invalid_request', message, 400);
}

function boundedId(value: string, field: string) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_ID_LENGTH) invalid(`The ${field} is not valid.`);
  return value;
}

function safeRevision(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid(`The ${field} is not valid.`);
  return value as number;
}

function encodeCursor(value: AlertCursor) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeCursor(value: string | null): AlertCursor | null {
  if (value === null) return null;
  if (value.length === 0 || value.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) invalid('The alert cursor is not valid.');
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
    const parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)))) as Partial<AlertCursor>;
    if (typeof parsed.createdAt !== 'string' || parsed.createdAt.length === 0 || parsed.createdAt.length > 64 ||
        typeof parsed.eventId !== 'string' || parsed.eventId.length === 0 || parsed.eventId.length > MAX_ID_LENGTH) invalid('The alert cursor is not valid.');
    return { createdAt: parsed.createdAt, eventId: parsed.eventId };
  } catch (error) {
    if (error instanceof MobileReviewError) throw error;
    invalid('The alert cursor is not valid.');
  }
}

function pageQuery(params: URLSearchParams) {
  const limitParam = params.get('limit');
  let limit = DEFAULT_PAGE_LIMIT;
  if (limitParam !== null) {
    if (!/^\d+$/.test(limitParam)) invalid('The alert page limit is not valid.');
    limit = Number(limitParam);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) invalid('The alert page limit must be between 1 and 100.');
  }
  return { limit, cursor: decodeCursor(params.get('cursor')) };
}

function countedMoney(row: AlertPageRow) {
  if (typeof row.counted_currency !== 'string' || !/^[A-Z]{3}$/.test(row.counted_currency) ||
      !Number.isSafeInteger(row.counted_amount_minor) || (row.counted_amount_minor as number) < 1) return null;
  return { currency: row.counted_currency, amountMinor: row.counted_amount_minor as number };
}

function eventMoney(row: AlertPageRow) {
  if (typeof row.event_money_currency !== 'string' || !/^[A-Z]{3}$/.test(row.event_money_currency) ||
      !Number.isSafeInteger(row.event_money_amount_minor) || (row.event_money_amount_minor as number) < 1) return null;
  return { currency: row.event_money_currency, amountMinor: row.event_money_amount_minor as number };
}

function boundedJsonStrings(value: string | null | undefined, max: number) {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 64)
      .slice(0, max);
  } catch {
    return [];
  }
}

function boundedText(value: string | null | undefined, max: number) {
  return typeof value === 'string' && value.length <= max ? value : null;
}

function placeholders(count: number) {
  return Array.from({ length: count }, () => '?').join(', ');
}

function relationForCandidate(row: AlertPageRow) {
  if (row.event_type === 'refund_notice') return 'refund_of' as const;
  if (row.event_type === 'purchase_notice' || row.event_type === 'fee_notice') return 'confirms' as const;
  return null;
}

function candidateCanLink(row: AlertPageRow, candidate: CandidatePageRow, relation: string | null) {
  const money = eventMoney(row);
  if (!money || candidate.target_source !== 'statement' || candidate.target_account_id !== row.account_id || !relation) return false;
  if (relation === 'refund_of') {
    return row.direction === 'inflow' && candidate.target_currency === money.currency && candidate.target_amount_minor < 0 &&
      Math.abs(candidate.target_amount_minor) >= money.amountMinor && candidate.target_kind !== 'refund';
  }
  const expectedKind = row.event_type === 'fee_notice' ? 'fee' : 'expense';
  const expectedSign = row.direction === 'inflow' ? 1 : -1;
  return candidate.target_currency === money.currency && candidate.target_kind === expectedKind &&
    Math.sign(candidate.target_amount_minor) === expectedSign && Math.abs(candidate.target_amount_minor) === money.amountMinor &&
    (candidate.target_status === 'confirmed' || candidate.target_status === 'needs_review');
}

function candidateTarget(candidate: CandidatePageRow) {
  return {
    id: candidate.target_id,
    date: candidate.target_date,
    merchant: boundedText(candidate.target_merchant, 160) ?? 'Merchant unavailable',
    amountMinor: Number(candidate.target_amount_minor),
    currency: candidate.target_currency,
    kind: candidate.target_kind,
    status: candidate.target_status,
    source: candidate.target_source,
  };
}

async function tableExists(db: D1Database, name: string) {
  const row = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1").bind(name).first<{ name: string }>();
  return row?.name === name;
}

async function readAlertEvidence(db: D1Database, rows: readonly AlertPageRow[]) {
  const provenanceByProjection = new Map<string, ProvenanceRow[]>();
  const linksByEvent = new Map<string, LinkPageRow[]>();
  const candidatesByAlertTransaction = new Map<string, CandidatePageRow[]>();
  const annotationsByTransaction = new Map<string, {
    transactionId: string;
    expectedRevision: number;
    category: string;
    note: string | null;
  } | null>();
  const projectionIds = rows.map((row) => row.id);
  const eventIds = rows.map((row) => row.event_id);
  const transactionIds = rows.flatMap((row) => row.transaction_id ? [row.transaction_id] : []);

  if (projectionIds.length > 0) {
    const provenance = await db.prepare(`SELECT projection_id, source_kind, source_id, basis, revision
      FROM alert_projection_provenance
      WHERE ledger_id = 'personal' AND projection_id IN (${placeholders(projectionIds.length)})
      ORDER BY projection_id, revision ASC, id ASC
      LIMIT ?`).bind(...projectionIds, projectionIds.length * MAX_PROVENANCE_PER_ALERT).all<ProvenanceRow>();
    for (const item of provenance.results ?? []) {
      const list = provenanceByProjection.get(item.projection_id) ?? [];
      if (list.length < MAX_PROVENANCE_PER_ALERT) list.push(item);
      provenanceByProjection.set(item.projection_id, list);
    }
  }

  if (eventIds.length > 0) {
    const links = await db.prepare(`SELECT id, from_event_id, to_event_id, to_transaction_id, relation,
        allocated_currency, allocated_amount_minor, evidence_basis, revision
      FROM alert_event_links
      WHERE ledger_id = 'personal' AND from_event_id IN (${placeholders(eventIds.length)})
      ORDER BY from_event_id, revision ASC, id ASC
      LIMIT ?`).bind(...eventIds, eventIds.length * MAX_LINKS_PER_ALERT).all<LinkPageRow>();
    for (const item of links.results ?? []) {
      const list = linksByEvent.get(item.from_event_id) ?? [];
      if (list.length < MAX_LINKS_PER_ALERT) list.push(item);
      linksByEvent.set(item.from_event_id, list);
    }
  }

  if (transactionIds.length > 0 && await tableExists(db, 'statement_reconciliation_candidates')) {
    const candidates = await db.prepare(`SELECT c.id, c.statement_transaction_id, c.candidate_transaction_id,
        c.score, c.reason_codes_json, c.evidence_basis, c.status,
        t.id AS target_id, t.account_id AS target_account_id, t.date AS target_date, t.merchant AS target_merchant,
        t.amount_minor AS target_amount_minor, t.currency AS target_currency, t.kind AS target_kind,
        t.status AS target_status, t.source AS target_source
      FROM statement_reconciliation_candidates c
      JOIN transactions t ON t.id = c.statement_transaction_id
      WHERE c.ledger_id = 'personal'
        AND c.candidate_transaction_id IN (${placeholders(transactionIds.length)})
        AND t.source = 'statement'
        AND EXISTS (
          SELECT 1 FROM transaction_source_records source
          WHERE source.ledger_id = 'personal' AND source.source_kind = 'statement'
            AND source.transaction_id = t.id AND source.account_id = t.account_id
        )
      ORDER BY c.candidate_transaction_id,
        CASE c.status WHEN 'open' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END,
        c.score DESC, c.id ASC
      LIMIT ?`).bind(...transactionIds, transactionIds.length * MAX_CANDIDATES_PER_ALERT).all<CandidatePageRow>();
    for (const item of candidates.results ?? []) {
      const list = candidatesByAlertTransaction.get(item.candidate_transaction_id) ?? [];
      if (list.length < MAX_CANDIDATES_PER_ALERT) list.push(item);
      candidatesByAlertTransaction.set(item.candidate_transaction_id, list);
    }
  }

  if (transactionIds.length > 0 && await tableExists(db, 'annotation_revisions')) {
    const annotations = await db.prepare(`SELECT t.id AS transaction_id, t.category AS transaction_category,
        latest.revision AS annotation_revision, latest.category AS annotation_category, latest.note AS annotation_note
      FROM transactions t
      LEFT JOIN annotation_revisions latest ON latest.id = (
        SELECT candidate.id
        FROM annotation_revisions candidate
        WHERE candidate.ledger_id = 'personal' AND candidate.transaction_id = t.id
        ORDER BY candidate.revision DESC, candidate.id DESC
        LIMIT 1
      )
      WHERE t.id IN (${placeholders(transactionIds.length)})
        AND EXISTS (
          SELECT 1 FROM transaction_source_records source
          WHERE source.ledger_id = 'personal'
            AND source.transaction_id = t.id
            AND source.account_id = t.account_id
        )`).bind(...transactionIds).all<AnnotationPageRow>();
    for (const item of annotations.results ?? []) {
      const category = boundedText(item.annotation_category ?? item.transaction_category, MAX_CATEGORY_LENGTH);
      const note = item.annotation_note === null ? null : boundedText(item.annotation_note, MAX_NOTE_LENGTH);
      annotationsByTransaction.set(item.transaction_id, category === null || (item.annotation_note !== null && note === null)
        ? null
        : {
          transactionId: item.transaction_id,
          expectedRevision: Number(item.annotation_revision ?? 0),
          category,
          note,
        });
    }
  }

  return { provenanceByProjection, linksByEvent, candidatesByAlertTransaction, annotationsByTransaction };
}

function reportingDate(row: AlertPageRow) {
  if (row.transaction_date) return row.transaction_date;
  if (row.event_time_basis !== 'notification_posted' || !row.notification_posted_at) return null;
  try {
    return reportingDateForInstant(row.notification_posted_at, 'America/Toronto');
  } catch {
    return null;
  }
}

function normalizeTimestamp(value: string | null | undefined) {
  if (!value) throw new MobileReviewError('temporarily_unavailable', 'The durable review acknowledgement is unavailable.', 503);
  const normalized = /Z$|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value.replace(' ', 'T')}Z`;
  const timestamp = new Date(normalized);
  if (!Number.isFinite(timestamp.valueOf())) throw new MobileReviewError('temporarily_unavailable', 'The durable review acknowledgement is unavailable.', 503);
  return timestamp.toISOString();
}

export async function readMobileAlertPage(db: D1Database, params: URLSearchParams) {
  const { limit, cursor } = pageQuery(params);
  const clauses = [
    "p.ledger_id = 'personal'",
    "e.ledger_id = 'personal'",
  ];
  const bindings: unknown[] = [];
  if (cursor) {
    clauses.push('(e.created_at < ? OR (e.created_at = ? AND e.event_id < ?))');
    bindings.push(cursor.createdAt, cursor.createdAt, cursor.eventId);
  }
  const result = await db.prepare(`SELECT p.id, p.event_id, p.transaction_id, p.state, p.revision, p.updated_at,
      p.reason_codes_json, p.counted_currency, p.counted_amount_minor, e.event_type, e.event_time_basis,
      e.notification_posted_at, e.captured_at, e.source_profile_id, e.parser_version, e.bank_reference,
      e.merchant, e.account_id, e.direction, e.event_money_currency, e.event_money_amount_minor,
      t.date AS transaction_date, e.created_at
    FROM alert_projections p
    JOIN alert_events e ON e.event_id = p.event_id
    LEFT JOIN transactions t ON t.id = p.transaction_id AND t.account_id = e.account_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY e.created_at DESC, e.event_id DESC
    LIMIT ?`).bind(...bindings, limit + 1).all<AlertPageRow>();
  const rows = result.results ?? [];
  const hasMore = rows.length > limit;
  const visibleRows = hasMore ? rows.slice(0, limit) : rows;
  const last = visibleRows.at(-1);
  const evidence = await readAlertEvidence(db, visibleRows);
  return {
    items: visibleRows.map((row) => {
      const provenance = (evidence.provenanceByProjection.get(row.id) ?? []).map((item) => ({
        sourceKind: boundedText(item.source_kind, 64) ?? 'unknown',
        sourceId: boundedText(item.source_id, MAX_ID_LENGTH) ?? 'unknown',
        basis: boundedText(item.basis, 64) ?? 'unknown',
        revision: Number(item.revision),
      }));
      const links = (evidence.linksByEvent.get(row.event_id) ?? []).map((item) => ({
        id: boundedText(item.id, MAX_ID_LENGTH) ?? 'unknown',
        targetEventId: item.to_event_id,
        targetTransactionId: item.to_transaction_id,
        relation: boundedText(item.relation, 64) ?? 'unknown',
        allocatedMoney: item.allocated_currency && Number.isSafeInteger(item.allocated_amount_minor) && (item.allocated_amount_minor as number) > 0
          ? { currency: item.allocated_currency, amountMinor: Number(item.allocated_amount_minor) }
          : null,
        evidenceBasis: boundedText(item.evidence_basis, 64) ?? 'unknown',
        revision: Number(item.revision),
      }));
      const candidateRows = row.transaction_id ? (evidence.candidatesByAlertTransaction.get(row.transaction_id) ?? []) : [];
      const hasPersonalTransaction = row.transaction_id !== null && evidence.annotationsByTransaction.has(row.transaction_id);
      const annotation = hasPersonalTransaction ? evidence.annotationsByTransaction.get(row.transaction_id!) : undefined;
      const annotationDisabledReason = !row.transaction_id
        ? 'Category/note disabled: this alert has no durable transaction target.'
        : !hasPersonalTransaction
          ? 'Category/note disabled: the transaction is not available in the personal ledger.'
          : annotation === null
            ? 'Category/note disabled: the personal transaction annotation is not safely bounded.'
            : null;
      const relation = relationForCandidate(row);
      const candidates = candidateRows.map((candidate) => ({
        id: candidate.id,
        statementTransactionId: candidate.statement_transaction_id,
        candidateTransactionId: candidate.candidate_transaction_id,
        score: Number(candidate.score),
        reasonCodes: boundedJsonStrings(candidate.reason_codes_json, MAX_REASON_CODES),
        status: candidate.status,
        evidenceBasis: candidate.evidence_basis,
        relation: relation && candidateCanLink(row, candidate, relation) ? relation : null,
        targetTransaction: candidateTarget(candidate),
      }));
      const openCandidates = candidateRows.filter((candidate) => candidate.status === 'open');
      const validCandidates = candidateRows.filter((candidate) => candidate.status === 'open' && candidateCanLink(row, candidate, relation));
      const existingTargetIds = new Set(links.flatMap((link) => link.targetTransactionId ? [link.targetTransactionId] : []));
      const actionableCandidates = validCandidates.filter((candidate) => !existingTargetIds.has(candidate.statement_transaction_id));
      const linkAction = (row.state === 'needs_review' || row.state === 'provisional') && actionableCandidates.length === 1 && row.transaction_id ? {
        targetId: actionableCandidates[0].statement_transaction_id,
        candidateTransactionId: row.transaction_id,
        relation,
        allocatedMoney: relation === 'refund_of' ? eventMoney(row) : null,
      } : null;
      const linkDisabledReason = row.state !== 'needs_review' && row.state !== 'provisional'
        ? `Link disabled: this alert is already in state ${row.state}; only provisional or needs_review alerts can be linked.`
        : candidateRows.length === 0
          ? 'Link disabled: no open reconciliation candidate is available for this alert.'
          : openCandidates.length === 0
            ? 'Link disabled: every reconciliation candidate for this alert is already resolved.'
          : relation === null
            ? 'Link disabled: the current reconciliation store has no safe relation for this alert type.'
            : row.transaction_id === null
              ? 'Link disabled: this alert has no durable candidate transaction target.'
            : actionableCandidates.length > 1
              ? 'Link disabled: multiple valid candidate transactions require an explicit target.'
              : actionableCandidates.length === 0 && validCandidates.length > 0
                ? 'Link disabled: this alert already has a durable link to its candidate.'
                : actionableCandidates.length === 0
                  ? 'Link disabled: the candidate does not match the alert account, amount, currency, or relation rules.'
                  : null;
      return {
        eventId: row.event_id,
        transactionId: hasPersonalTransaction ? row.transaction_id : null,
        eventType: row.event_type,
        state: row.state,
        countedMoney: countedMoney(row),
        affectedMoney: eventMoney(row) ?? countedMoney(row),
        reportingDate: reportingDate(row),
        revision: Number(row.revision),
        reasonCodes: boundedJsonStrings(row.reason_codes_json, MAX_REASON_CODES),
        sourceEvidence: {
          sourceProfileId: boundedText(row.source_profile_id, MAX_ID_LENGTH),
          parserVersion: boundedText(row.parser_version, 64),
          eventTimeBasis: boundedText(row.event_time_basis, 64),
          capturedAt: boundedText(row.captured_at, 64),
          notificationPostedAt: boundedText(row.notification_posted_at, 64),
          bankReference: boundedText(row.bank_reference, 128),
          merchant: boundedText(row.merchant, 160),
          eventMoney: eventMoney(row),
        },
        provenance,
        candidates,
        links,
        linkAction,
        linkDisabledReason,
        annotation: annotation ?? null,
        annotationDisabledReason,
      };
    }),
    page: {
      nextCursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, eventId: last.event_id }) : null,
      limit,
    },
  };
}

async function readAlertProjection(db: D1Database, eventId: string) {
  const row = await db.prepare(`SELECT p.id, p.event_id, p.transaction_id, p.state, p.revision, p.updated_at,
      p.reason_codes_json, p.counted_currency, p.counted_amount_minor
    FROM alert_projections p
    JOIN alert_events e ON e.event_id = p.event_id
    WHERE p.ledger_id = 'personal' AND e.ledger_id = 'personal' AND p.event_id = ? LIMIT 1`).bind(eventId).first<AlertProjectionRow>();
  return row;
}

function conflict(currentRevision: number): never {
  throw new MobileReviewError('revision_conflict', 'The review revision changed elsewhere.', 409, currentRevision);
}

function reviewable(row: AlertProjectionRow, expectedRevision: number, decision: AlertReviewDecision) {
  if (row.revision !== expectedRevision) conflict(row.revision);
  if (row.state !== 'needs_review' && !(decision === 'link' && row.state === 'provisional')) {
    throw new MobileReviewError('not_reviewable', decision === 'link'
      ? 'Only provisional or needs_review alerts can be linked.'
      : 'Only needs_review alerts can be resolved.', 409, row.revision);
  }
}

function reviewTarget(relation: AlertReviewRelation, targetId: string, candidateTransactionId: string | null) {
  if (relation === 'replaces_authorization') throw new MobileReviewError('unsupported_relation', 'The requested review relation is not supported by the reconciliation store.', 400);
  if (LIFECYCLE_RELATIONS.has(relation)) return { targetAlertEventId: targetId };
  return { statementTransactionId: targetId, ...(candidateTransactionId ? { candidateTransactionId } : {}) };
}

async function openCandidateForReview(db: D1Database, row: AlertProjectionRow, targetId: string, candidateTransactionId: string | null) {
  if (!row.transaction_id || !(await tableExists(db, 'statement_reconciliation_candidates'))) {
    throw new MobileReviewError('candidate_missing', 'A link review requires an open reconciliation candidate for this alert.', 409, row.revision);
  }
  const candidateId = candidateTransactionId ?? row.transaction_id;
  const candidate = await db.prepare(`SELECT c.id
    FROM statement_reconciliation_candidates c
    JOIN transactions target ON target.id = c.statement_transaction_id
    WHERE c.ledger_id = 'personal' AND c.status = 'open'
      AND c.statement_transaction_id = ? AND c.candidate_transaction_id = ?
      AND target.source = 'statement'
      AND EXISTS (
        SELECT 1 FROM transaction_source_records source
        WHERE source.ledger_id = 'personal' AND source.source_kind = 'statement'
          AND source.transaction_id = target.id AND source.account_id = target.account_id
      )
    LIMIT 1`).bind(targetId, candidateId).first<{ id: string }>();
  if (!candidate) throw new MobileReviewError('candidate_missing', 'The selected candidate is no longer open for this alert.', 409, row.revision);
  return candidateId;
}

function parseReviewBody(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('The review body is not valid.');
  const record = body as Record<string, unknown>;
  const allowed = new Set(['expectedRevision', 'decision', 'targetId', 'candidateTransactionId', 'relation', 'allocatedMoney']);
  if (Object.keys(record).some((key) => !allowed.has(key))) invalid('The review contains an unknown field.');
  const expectedRevision = safeRevision(record.expectedRevision, 'expectedRevision');
  if (typeof record.decision !== 'string' || !ALERT_REVIEW_DECISIONS.includes(record.decision as AlertReviewDecision)) invalid('The review decision is not valid.');
  const decision = record.decision as AlertReviewDecision;
  const targetId = record.targetId === undefined || record.targetId === null ? null : boundedId(record.targetId as string, 'targetId');
  const candidateTransactionId = record.candidateTransactionId === undefined || record.candidateTransactionId === null ? null : boundedId(record.candidateTransactionId as string, 'candidateTransactionId');
  const relation = record.relation === undefined || record.relation === null ? null : record.relation;
  if (relation !== null && (typeof relation !== 'string' || !ALERT_REVIEW_RELATIONS.includes(relation as AlertReviewRelation))) invalid('The review relation is not valid.');
  let allocatedMoney: { currency: string; amountMinor: number } | null = null;
  if (record.allocatedMoney !== undefined && record.allocatedMoney !== null) {
    if (!record.allocatedMoney || typeof record.allocatedMoney !== 'object' || Array.isArray(record.allocatedMoney)) invalid('The allocated money is not valid.');
    const money = record.allocatedMoney as Record<string, unknown>;
    if (typeof money.currency !== 'string' || getCurrencyMeta(money.currency) === null || !Number.isSafeInteger(money.amountMinor) || (money.amountMinor as number) < 1) invalid('The allocated money is not valid.');
    allocatedMoney = { currency: money.currency, amountMinor: money.amountMinor as number };
  }
  if (decision === 'keep_separate' || decision === 'ignore') {
    if (targetId !== null || candidateTransactionId !== null || relation !== null || allocatedMoney !== null) invalid('This review decision does not accept a target or allocation.');
  }
  if (decision === 'link') {
    if (!targetId || !relation) invalid('A link review requires a targetId and relation.');
  }
  if (decision === 'classify') throw new MobileReviewError('unsupported_decision', 'Classification review is not available through the current reconciliation store.', 400);
  return { expectedRevision, decision, targetId, candidateTransactionId, relation: relation as AlertReviewRelation | null, allocatedMoney };
}

async function standaloneDecision(db: D1Database, row: AlertProjectionRow, expectedRevision: number, decision: 'keep_separate' | 'ignore') {
  const revision = expectedRevision + 1;
  const nextState = decision === 'ignore' ? 'non_spending' : 'provisional';
  const reasonCodes = JSON.stringify([decision === 'ignore' ? 'ignored_by_owner' : 'kept_separate']);
  const reviewId = `mobile-review:${row.event_id}:${revision}`;
  const statements: D1Statement[] = [
    db.prepare(`UPDATE alert_projections SET state = ?, reason_codes_json = ?,
        counted_currency = CASE WHEN ? = 'keep_separate' THEN counted_currency ELSE NULL END,
        counted_amount_minor = CASE WHEN ? = 'keep_separate' THEN counted_amount_minor ELSE NULL END,
        revision = revision + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND ledger_id = 'personal' AND revision = ? AND state = 'needs_review'`)
      .bind(nextState, reasonCodes, decision, decision, row.id, expectedRevision),
    db.prepare(`UPDATE transactions SET status = CASE WHEN ? = 'ignore' THEN 'needs_review' ELSE 'provisional' END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = (SELECT transaction_id FROM alert_projections WHERE id = ? AND ledger_id = 'personal' AND revision = ?)
        AND source = 'alert'`)
      .bind(decision, row.id, revision),
    db.prepare(`INSERT INTO alert_projection_provenance
        (id, ledger_id, projection_id, source_kind, source_id, basis, revision)
      SELECT ?, 'personal', id, 'review', ?, 'user_review', ?
      FROM alert_projections
      WHERE id = ? AND ledger_id = 'personal' AND revision = ?
        AND NOT EXISTS (SELECT 1 FROM alert_projection_provenance WHERE id = ?)`)
      .bind(reviewId, reviewId, revision, row.id, revision, reviewId),
  ];
  const results = await db.batch(statements);
  if (Number(results[0]?.meta?.changes ?? 0) !== 1) {
    const current = await readAlertProjection(db, row.event_id);
    if (!current) throw new MobileReviewError('not_found', 'The alert was not found in the personal ledger.', 404);
    conflict(current.revision);
  }
}

async function advanceUnresolvedLinkReview(db: D1Database, row: AlertProjectionRow, expectedRevision: number) {
  const revision = expectedRevision + 1;
  const result = await db.prepare(`UPDATE alert_projections
    SET revision = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND ledger_id = 'personal' AND revision = ? AND state IN ('needs_review', 'provisional')`)
    .bind(revision, row.id, expectedRevision).run();
  if (Number(result.meta?.changes ?? 0) === 1) return;
  const current = await readAlertProjection(db, row.event_id);
  if (!current) throw new MobileReviewError('not_found', 'The alert was not found in the personal ledger.', 404);
  if (current.revision === revision) return;
  conflict(current.revision);
}

function mapReconciliationError(error: unknown): never {
  if (error instanceof MobileReviewError) throw error;
  if (error instanceof ReconciliationConflictError) throw new MobileReviewError(error.code, error.message, 409);
  if (error instanceof ReconciliationReviewError) {
    const notFound = new Set(['alert_scope_mismatch', 'projection_missing', 'target_missing']);
    throw new MobileReviewError(error.code, error.message, notFound.has(error.code) ? 404 : 409);
  }
  throw error;
}

export async function applyMobileAlertReview(db: D1Database, eventId: string, body: unknown) {
  boundedId(eventId, 'eventId');
  const input = parseReviewBody(body);
  const row = await readAlertProjection(db, eventId);
  if (!row) throw new MobileReviewError('not_found', 'The alert was not found in the personal ledger.', 404);
  reviewable(row, input.expectedRevision, input.decision);

  if (input.decision === 'keep_separate' || input.decision === 'ignore') {
    await standaloneDecision(db, row, input.expectedRevision, input.decision);
  } else {
    const candidateTransactionId = input.relation && !LIFECYCLE_RELATIONS.has(input.relation)
      ? await openCandidateForReview(db, row, input.targetId!, input.candidateTransactionId)
      : null;
    const target = reviewTarget(input.relation!, input.targetId!, candidateTransactionId);
    try {
      await applyAlertReview(db, {
        id: `mobile-review:${eventId}:${input.expectedRevision + 1}`,
        alertEventId: eventId,
        ...target,
        relation: input.relation === 'replaces_authorization' ? undefined : (input.relation ?? undefined),
        ...(input.allocatedMoney ? { allocatedCurrency: input.allocatedMoney.currency, allocatedAmountMinor: input.allocatedMoney.amountMinor } : {}),
        evidenceBasis: 'user_review',
        revision: input.expectedRevision + 1,
      });
    } catch (error) {
      if (error instanceof ReconciliationReviewError && error.code === 'stale_revision') {
        const current = await readAlertProjection(db, eventId);
        if (!current) throw new MobileReviewError('not_found', 'The alert was not found in the personal ledger.', 404);
        conflict(current.revision);
      }
      mapReconciliationError(error);
    }
    if (input.relation === 'refund_of' || input.relation === 'possible_duplicate') {
      await advanceUnresolvedLinkReview(db, row, input.expectedRevision);
    }
  }

  const acknowledged = await readAlertProjection(db, eventId);
  if (!acknowledged || acknowledged.revision !== input.expectedRevision + 1) {
    throw new MobileReviewError('temporarily_unavailable', 'The durable review acknowledgement is unavailable.', 503);
  }
  return {
    id: eventId,
    revision: acknowledged.revision,
    updatedAt: normalizeTimestamp(acknowledged.updated_at),
  };
}

async function readPersonalTransaction(db: D1Database, transactionId: string) {
  return db.prepare(`SELECT t.id
    FROM transactions t
    WHERE t.id = ? AND EXISTS (
      SELECT 1 FROM transaction_source_records source
      WHERE source.transaction_id = t.id
        AND source.account_id = t.account_id
        AND source.ledger_id = 'personal'
    ) LIMIT 1`).bind(transactionId).first<{ id: string }>();
}

async function readLatestPersonalAnnotation(db: D1Database, transactionId: string) {
  return db.prepare(`SELECT id, ledger_id, transaction_id, revision, created_at
    FROM annotation_revisions
    WHERE ledger_id = 'personal' AND transaction_id = ?
    ORDER BY revision DESC, id DESC LIMIT 1`).bind(transactionId).first<AnnotationRow>();
}

function annotationBody(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('The annotation body is not valid.');
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => !['expectedRevision', 'category', 'note'].includes(key))) invalid('The annotation contains an unknown field.');
  const expectedRevision = safeRevision(record.expectedRevision, 'expectedRevision');
  if (typeof record.category !== 'string' || record.category.trim().length === 0 || record.category.length > MAX_CATEGORY_LENGTH) invalid('The category is not valid.');
  if (record.note !== null && (typeof record.note !== 'string' || record.note.length > MAX_NOTE_LENGTH)) invalid('The note is not valid.');
  if (!Object.prototype.hasOwnProperty.call(record, 'note')) invalid('The note is required.');
  return { expectedRevision, category: record.category, note: record.note as string | null };
}

function isUniqueConflict(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /unique constraint failed|sqlite_constraint.*unique|constraint failed.*unique/i.test(message);
}

export async function annotateMobileTransaction(db: D1Database, transactionId: string, body: unknown, authorSubjectHash: string) {
  boundedId(transactionId, 'transactionId');
  const input = annotationBody(body);
  const transaction = await readPersonalTransaction(db, transactionId);
  if (!transaction) throw new MobileReviewError('not_found', 'The transaction was not found in the personal ledger.', 404);
  const current = await readLatestPersonalAnnotation(db, transactionId);
  const currentRevision = current?.revision ?? 0;
  if (currentRevision !== input.expectedRevision) conflict(currentRevision);
  const revision = input.expectedRevision + 1;
  const annotationId = `mobile-annotation:${transactionId}:${revision}`;
  try {
    await appendAnnotationRevision(db, {
      id: annotationId,
      ledgerId: LEDGER_ID,
      transactionId,
      authorSubjectHash,
      revision,
      category: input.category,
      note: input.note,
    });
  } catch (error) {
    if (isUniqueConflict(error)) {
      const latest = await readLatestPersonalAnnotation(db, transactionId);
      conflict(latest?.revision ?? revision);
    }
    throw error;
  }
  const acknowledged = await db.prepare(`SELECT id, ledger_id, transaction_id, revision, created_at
    FROM annotation_revisions
    WHERE id = ? AND ledger_id = 'personal' AND transaction_id = ? AND revision = ? LIMIT 1`)
    .bind(annotationId, transactionId, revision).first<AnnotationRow>();
  if (!acknowledged) throw new MobileReviewError('temporarily_unavailable', 'The durable annotation acknowledgement is unavailable.', 503);
  return {
    id: acknowledged.transaction_id,
    revision: acknowledged.revision,
    updatedAt: normalizeTimestamp(acknowledged.created_at),
  };
}
