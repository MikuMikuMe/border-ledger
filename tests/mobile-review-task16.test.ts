import { OWNER_LEDGER } from './helpers/tenants';
import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import { createOpaqueCredential, hashSecret } from '../worker/mobile-auth';
import { commitStatementRows } from '../worker/reconciliation-store';
import { task18MigrationNames } from './helpers/d1';
import { createAlertFixture, event, mobileEnv, postAlerts, CAPTURE_SECRET, ALERT_ENVIRONMENT, ALERT_ORIGIN, ALERT_SESSION_KEY } from './helpers/alerts';

const CONFIG = {
  canonicalOrigin: ALERT_ORIGIN,
  callbackUrl: `${ALERT_ORIGIN}/android/auth/callback`,
  environment: ALERT_ENVIRONMENT,
  accessAuthorizationUrl: 'https://access.example.com/authorize',
  sessionEncryptionKey: ALERT_SESSION_KEY,
};

async function owner(fixture: Awaited<ReturnType<typeof createAlertFixture>>, scopes: string[] = ['ledger:read', 'ledger:review']) {
  const familyId = `review-family-${crypto.randomUUID()}`;
  const ownerToken = await createOpaqueCredential({
    kind: 'owner-access',
    familyId,
    generation: 1,
    expiresAt: '2099-01-01T00:00:00.000Z',
    environmentHash: await hashSecret(ALERT_ENVIRONMENT),
  }, CONFIG);
  await fixture.db.prepare(`INSERT INTO owner_session_families
    (id, ledger_id, subject_hash, access_generation, refresh_generation, access_expires_at, refresh_expires_at, scope_json, environment_hash)
    VALUES (?, 'personal', 'review-subject', 1, 1, '2099-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', ?, ?)`)
    .bind(familyId, JSON.stringify(scopes), await hashSecret(ALERT_ENVIRONMENT)).run();
  return ownerToken;
}

function request(path: string, token: string, init: RequestInit = {}) {
  return new Request(`${ALERT_ORIGIN}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

describe('Task 16 mobile owner Review API', () => {
  it('rejects unknown allocated review currencies at the request boundary', async () => {
    const fixture = await createAlertFixture({ migrationNames: task18MigrationNames });
    const alertId = '00000000-0000-4000-8000-000000000031';
    await postAlerts(fixture.db, [event({ eventId: alertId, observationId: 'review-observation-31' })]);
    const token = await owner(fixture);

    const response = await worker.fetch(request(`/api/mobile/v1/alerts/${alertId}/review`, token, {
      method: 'PATCH',
      body: JSON.stringify({
        expectedRevision: 1,
        decision: 'link',
        targetId: 'missing-target',
        relation: 'confirms',
        allocatedMoney: { currency: 'XYZ', amountMinor: 1 },
      }),
    }), mobileEnv(fixture.db) as never);

    expect(response.status).toBe(400);
  });

  it('pages personal alert projections in the Android Review DTO and rejects capture reads', async () => {
    const fixture = await createAlertFixture({ migrationNames: task18MigrationNames });
    await postAlerts(fixture.db, [
      event(),
      event({ eventId: '00000000-0000-4000-8000-000000000002', observationId: 'observation-2', notificationPostedAt: '2026-10-13T04:01:00.000Z' }),
    ]);
    const token = await owner(fixture);

    const first = await worker.fetch(request('/api/mobile/v1/alerts?limit=1', token), mobileEnv(fixture.db) as never);
    expect(first.status).toBe(200);
    const firstBody = await first.json() as { items: Array<Record<string, unknown>>; page: { limit: number; nextCursor: string | null } };
    expect(firstBody.items).toHaveLength(1);
    expect(firstBody.items[0]).toMatchObject({
      eventId: expect.any(String),
      eventType: 'purchase_notice',
      state: 'provisional',
      countedMoney: { currency: 'CAD', amountMinor: 1234 },
      reportingDate: '2026-10-13',
      revision: 1,
    });
    expect(firstBody.page.limit).toBe(1);
    expect(firstBody.page.nextCursor).toEqual(expect.any(String));

    const second = await worker.fetch(request(`/api/mobile/v1/alerts?limit=1&cursor=${encodeURIComponent(firstBody.page.nextCursor!)}`, token), mobileEnv(fixture.db) as never);
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({
      items: [{ eventId: expect.not.stringMatching(firstBody.items[0].eventId as string) }],
      page: { limit: 1, nextCursor: null },
    });

    const captureRead = await worker.fetch(request('/api/mobile/v1/alerts', CAPTURE_SECRET), mobileEnv(fixture.db) as never);
    expect(captureRead.status).toBe(401);
  }, 30_000);

  it('returns bounded review evidence and a safe candidate link action without mutating source evidence', async () => {
    const fixture = await createAlertFixture({ migrationNames: task18MigrationNames });
    const alertId = '00000000-0000-4000-8000-000000000021';
    await postAlerts(fixture.db, [event({
      eventId: alertId,
      observationId: 'review-observation-21',
      bankReference: null,
    })]);
    const sourceBefore = (await fixture.db.prepare('SELECT payload_digest, merchant, event_money_currency, event_money_amount_minor FROM alert_events WHERE event_id = ?').bind(alertId).all()).results;
    await commitStatementRows(fixture.db, OWNER_LEDGER, {
      importId: 'review-candidate-import',
      accountId: 'account-boc',
      filename: 'review.csv',
      fileSha256: '9'.repeat(64),
      rows: [{
        id: 'review-statement-row',
        accountId: 'account-boc',
        date: '2026-10-13',
        merchant: 'Synthetic merchant',
        amountMinor: -1234,
        currency: 'CAD',
        category: 'Groceries',
        kind: 'expense',
        status: 'confirmed',
        source: 'statement',
        fingerprint: 'review-candidate-fingerprint',
        sourceIdentity: { accountId: 'account-boc', fileSha256: '9'.repeat(64), rowIndex: 0 },
      }],
    });
    await expect(fixture.db.prepare(`SELECT id, fx_lock_date FROM transactions
      WHERE id IN (?, ?) ORDER BY id`).bind(alertId, 'review-statement-row').all()).resolves.toMatchObject({
      results: [
        { id: alertId, fx_lock_date: '2026-10-13' },
        { id: 'review-statement-row', fx_lock_date: '2026-10-13' },
      ],
    });
    const token = await owner(fixture);

    const response = await worker.fetch(request('/api/mobile/v1/alerts?limit=1', token), mobileEnv(fixture.db) as never);
    expect(response.status).toBe(200);
    const body = await response.json() as { items: Array<Record<string, unknown>> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      eventId: alertId,
      reasonCodes: [],
      affectedMoney: { currency: 'CAD', amountMinor: 1234 },
      sourceEvidence: {
        sourceProfileId: 'source-boc',
        parserVersion: 'parser-test-1',
        eventTimeBasis: 'notification_posted',
      },
      provenance: [{ sourceKind: 'alert', sourceId: alertId, basis: 'alert_event', revision: 1 }],
      candidates: [{
        id: expect.any(String),
        statementTransactionId: 'review-statement-row',
        candidateTransactionId: alertId,
        status: 'open',
        targetTransaction: {
          id: 'review-statement-row',
          amountMinor: -1234,
          currency: 'CAD',
          merchant: 'Synthetic merchant',
        },
      }],
      linkAction: {
        targetId: 'review-statement-row',
        candidateTransactionId: alertId,
        relation: 'confirms',
      },
      links: [],
    });
    expect((body.items[0].reasonCodes as unknown[]).length).toBeLessThanOrEqual(8);
    expect((body.items[0].provenance as unknown[]).length).toBeLessThanOrEqual(8);
    expect((body.items[0].candidates as unknown[]).length).toBeLessThanOrEqual(5);

    const linkAction = body.items[0].linkAction as { targetId: string; candidateTransactionId: string; relation: string };
    await expect(fixture.db.prepare('SELECT status FROM statement_reconciliation_candidates WHERE statement_transaction_id = ?').bind('review-statement-row').all())
      .resolves.toMatchObject({ results: [{ status: 'open' }] });
    const linked = await worker.fetch(request(`/api/mobile/v1/alerts/${alertId}/review`, token, {
      method: 'PATCH',
      body: JSON.stringify({
        expectedRevision: 1,
        decision: 'link',
        targetId: linkAction.targetId,
        candidateTransactionId: linkAction.candidateTransactionId,
        relation: linkAction.relation,
      }),
    }), mobileEnv(fixture.db) as never);
    expect(linked.status).toBe(200);
    await expect(linked.json()).resolves.toMatchObject({ id: alertId, revision: 2 });
    await expect(fixture.db.prepare('SELECT status FROM statement_reconciliation_candidates WHERE statement_transaction_id = ?').bind('review-statement-row').all())
      .resolves.toMatchObject({ results: [] });
    await expect(fixture.db.prepare('SELECT relation, to_transaction_id, evidence_basis FROM alert_event_links WHERE from_event_id = ?').bind(alertId).all())
      .resolves.toMatchObject({ results: [{ relation: 'confirms', to_transaction_id: 'review-statement-row', evidence_basis: 'user_review' }] });
    await expect(fixture.db.prepare('SELECT payload_digest, merchant, event_money_currency, event_money_amount_minor FROM alert_events WHERE event_id = ?').bind(alertId).all())
      .resolves.toMatchObject({ results: sourceBefore });
    await expect(fixture.db.prepare(`SELECT id, fx_lock_date FROM transactions
      WHERE id IN (?, ?) ORDER BY id`).bind(alertId, 'review-statement-row').all()).resolves.toMatchObject({
      results: [{ id: 'review-statement-row', fx_lock_date: '2026-10-13' }],
    });
  }, 30_000);

  it('durably applies keep-separate and ignore decisions with revision conflicts', async () => {
    const fixture = await createAlertFixture({ migrationNames: task18MigrationNames });
    const reviewEvent = event({
      eventId: '00000000-0000-4000-8000-000000000011',
      observationId: 'review-observation-11',
      completeness: { individualTimestamp: false, supportedSource: true, labeledMoney: true },
    });
    const ignoredEvent = event({
      eventId: '00000000-0000-4000-8000-000000000012',
      observationId: 'review-observation-12',
      completeness: { individualTimestamp: false, supportedSource: true, labeledMoney: true },
    });
    await postAlerts(fixture.db, [reviewEvent, ignoredEvent]);
    const token = await owner(fixture, ['ledger:review']);
    const locksBefore = (await fixture.db.prepare(`SELECT id, fx_lock_date FROM transactions
      WHERE id IN (?, ?) ORDER BY id`).bind(reviewEvent.eventId, ignoredEvent.eventId).all()).results;

    const keep = await worker.fetch(request(`/api/mobile/v1/alerts/${reviewEvent.eventId}/review`, token, {
      method: 'PATCH',
      body: JSON.stringify({ expectedRevision: 1, decision: 'keep_separate' }),
    }), mobileEnv(fixture.db) as never);
    expect(keep.status).toBe(200);
    await expect(keep.json()).resolves.toMatchObject({ id: reviewEvent.eventId, revision: 2, updatedAt: expect.any(String) });
    await expect(fixture.db.prepare('SELECT state, revision, counted_currency, counted_amount_minor FROM alert_projections WHERE event_id = ?').bind(reviewEvent.eventId).all())
      .resolves.toMatchObject({ results: [{ state: 'provisional', revision: 2, counted_currency: null, counted_amount_minor: null }] });

    const ignore = await worker.fetch(request(`/api/mobile/v1/alerts/${ignoredEvent.eventId}/review`, token, {
      method: 'PATCH',
      body: JSON.stringify({ expectedRevision: 1, decision: 'ignore' }),
    }), mobileEnv(fixture.db) as never);
    expect(ignore.status).toBe(200);
    await expect(ignore.json()).resolves.toMatchObject({ id: ignoredEvent.eventId, revision: 2 });
    await expect(fixture.db.prepare('SELECT state, revision FROM alert_projections WHERE event_id = ?').bind(ignoredEvent.eventId).all())
      .resolves.toMatchObject({ results: [{ state: 'non_spending', revision: 2 }] });
    await expect(fixture.db.prepare(`SELECT id, fx_lock_date FROM transactions
      WHERE id IN (?, ?) ORDER BY id`).bind(reviewEvent.eventId, ignoredEvent.eventId).all())
      .resolves.toMatchObject({ results: locksBefore });

    const stale = await worker.fetch(request(`/api/mobile/v1/alerts/${ignoredEvent.eventId}/review`, token, {
      method: 'PATCH',
      body: JSON.stringify({ expectedRevision: 1, decision: 'ignore' }),
    }), mobileEnv(fixture.db) as never);
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ code: 'revision_conflict', currentRevision: 2 });
  }, 30_000);

  it('appends only personal transaction annotations and reports durable revision conflicts', async () => {
    const fixture = await createAlertFixture({ migrationNames: task18MigrationNames });
    await fixture.db.batch([
      fixture.db.prepare(`INSERT INTO transactions
        (id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint)
        VALUES ('review-transaction', 'account-boc', '2026-10-13', 'Review merchant', -1234, 'CAD', 'Uncategorized', 'expense', 'needs_review', 'manual', 'review-transaction-fingerprint')`),
      fixture.db.prepare(`INSERT INTO transaction_source_records
        (id, ledger_id, source_kind, identity_key, transaction_id, account_id, content_digest)
        VALUES ('review-source-record', 'personal', 'legacy', 'legacy:review-transaction', 'review-transaction', 'account-boc', 'review-content')`),
    ]);
    const token = await owner(fixture, ['ledger:review']);

    const saved = await worker.fetch(request('/api/mobile/v1/transactions/review-transaction/annotation', token, {
      method: 'PATCH',
      body: JSON.stringify({ expectedRevision: 0, category: 'Travel', note: 'Owner reviewed this row.' }),
    }), mobileEnv(fixture.db) as never);
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({ id: 'review-transaction', revision: 1, updatedAt: expect.any(String) });
    await expect(fixture.db.prepare('SELECT ledger_id, transaction_id, revision, category, note FROM annotation_revisions WHERE transaction_id = ?').bind('review-transaction').all())
      .resolves.toMatchObject({ results: [{ ledger_id: 'personal', transaction_id: 'review-transaction', revision: 1, category: 'Travel', note: 'Owner reviewed this row.' }] });

    const stale = await worker.fetch(request('/api/mobile/v1/transactions/review-transaction/annotation', token, {
      method: 'PATCH',
      body: JSON.stringify({ expectedRevision: 0, category: 'Other', note: null }),
    }), mobileEnv(fixture.db) as never);
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ code: 'revision_conflict', currentRevision: 1 });

    await fixture.db.batch([
      fixture.db.prepare("INSERT INTO users(id) VALUES ('other-user')"),
      fixture.db.prepare("INSERT INTO ledgers (id,user_id) VALUES ('other-ledger','other-user')"),
      fixture.db.prepare("INSERT INTO accounts(id,ledger_id,name,institution,currency,kind,status) VALUES ('other-account','other-ledger','Other','Bank','CAD','savings','connected')"),
      fixture.db.prepare(`INSERT INTO transactions
        (id, ledger_id, account_id, date, merchant, amount_minor, currency, category, kind, status, source, fingerprint)
        VALUES ('other-transaction', 'other-ledger', 'other-account', '2026-10-13', 'Other ledger merchant', -100, 'CAD', 'Other', 'expense', 'needs_review', 'manual', 'other-transaction-fingerprint')`),
      fixture.db.prepare(`INSERT INTO transaction_source_records
        (id, ledger_id, source_kind, identity_key, transaction_id, account_id, content_digest)
        VALUES ('other-source-record', 'other-ledger', 'legacy', 'legacy:other-transaction', 'other-transaction', 'other-account', 'other-content')`),
    ]);
    const outOfScope = await worker.fetch(request('/api/mobile/v1/transactions/other-transaction/annotation', token, {
      method: 'PATCH',
      body: JSON.stringify({ expectedRevision: 0, category: 'Other', note: null }),
    }), mobileEnv(fixture.db) as never);
    expect(outOfScope.status).toBe(404);
  }, 30_000);

  it('exposes an owner-scoped annotation action with its current CAS revision', async () => {
    const fixture = await createAlertFixture({ migrationNames: task18MigrationNames });
    const reviewEvent = event({
      eventId: '00000000-0000-4000-8000-000000000031',
      observationId: 'review-observation-31',
    });
    await postAlerts(fixture.db, [reviewEvent]);
    await fixture.db.batch([
      fixture.db.prepare(`INSERT INTO annotation_revisions
        (id, ledger_id, transaction_id, author_subject_hash, revision, category, note)
        VALUES ('review-annotation-31', 'personal', ?, 'reviewer', 2, 'Travel', 'Review this category')`).bind(reviewEvent.eventId),
    ]);
    const token = await owner(fixture, ['ledger:read', 'ledger:review']);

    const response = await worker.fetch(request('/api/mobile/v1/alerts?limit=1', token), mobileEnv(fixture.db) as never);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [{
        eventId: reviewEvent.eventId,
        transactionId: reviewEvent.eventId,
        annotation: {
          transactionId: reviewEvent.eventId,
          expectedRevision: 2,
          category: 'Travel',
          note: 'Review this category',
        },
        annotationDisabledReason: null,
      }],
    });
  }, 30_000);

  it('exposes a personal transaction annotation target at revision zero before any annotation exists', async () => {
    const fixture = await createAlertFixture({ migrationNames: task18MigrationNames });
    const reviewEvent = event({
      eventId: '00000000-0000-4000-8000-000000000033',
      observationId: 'review-observation-33',
    });
    await postAlerts(fixture.db, [reviewEvent]);
    const token = await owner(fixture, ['ledger:read', 'ledger:review']);

    const response = await worker.fetch(request('/api/mobile/v1/alerts?limit=1', token), mobileEnv(fixture.db) as never);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [{
        eventId: reviewEvent.eventId,
        transactionId: reviewEvent.eventId,
        annotation: {
          transactionId: reviewEvent.eventId,
          expectedRevision: 0,
          category: 'Uncategorized',
          note: null,
        },
        annotationDisabledReason: null,
      }],
    });

    const saved = await worker.fetch(request(`/api/mobile/v1/transactions/${reviewEvent.eventId}/annotation`, token, {
      method: 'PATCH',
      body: JSON.stringify({ expectedRevision: 0, category: 'Travel', note: 'Created from the editable revision-zero target.' }),
    }), mobileEnv(fixture.db) as never);
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({ id: reviewEvent.eventId, revision: 1 });
  }, 30_000);

  it('rejects stale Review annotation decisions without changing the existing endpoint semantics', async () => {
    const fixture = await createAlertFixture({ migrationNames: task18MigrationNames });
    const reviewEvent = event({
      eventId: '00000000-0000-4000-8000-000000000032',
      observationId: 'review-observation-32',
    });
    await postAlerts(fixture.db, [reviewEvent]);
    const token = await owner(fixture, ['ledger:review']);

    const saved = await worker.fetch(request(`/api/mobile/v1/transactions/${reviewEvent.eventId}/annotation`, token, {
      method: 'PATCH',
      body: JSON.stringify({ expectedRevision: 0, category: 'Travel', note: 'First edit' }),
    }), mobileEnv(fixture.db) as never);
    expect(saved.status).toBe(200);

    const stale = await worker.fetch(request(`/api/mobile/v1/transactions/${reviewEvent.eventId}/annotation`, token, {
      method: 'PATCH',
      body: JSON.stringify({ expectedRevision: 0, category: 'Other', note: 'Must not overwrite' }),
    }), mobileEnv(fixture.db) as never);
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ code: 'revision_conflict', currentRevision: 1 });
    await expect(fixture.db.prepare('SELECT category, note FROM annotation_revisions WHERE transaction_id = ? ORDER BY revision DESC LIMIT 1').bind(reviewEvent.eventId).all())
      .resolves.toMatchObject({ results: [{ category: 'Travel', note: 'First edit' }] });
  }, 30_000);
});
