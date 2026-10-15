import { afterEach } from 'vitest';
import { applyMigrations, createD1Fixture, task18MigrationNames } from './d1';
import { hashSecret } from '../../worker/mobile-auth';
import type { BankAlertEventInput } from '../../src/domain/bank-alerts';

export const ALERT_ORIGIN = 'https://pf.example.com';
export const ALERT_ENVIRONMENT = 'sandbox';
export const ALERT_SESSION_KEY = 'synthetic-session-key-for-alert-tests';
export const CAPTURE_SECRET = 'capture-secret-alert-tests';

const fixtures: Array<{ dispose(): Promise<void> }> = [];

afterEach(async () => {
  while (fixtures.length > 0) await fixtures.pop()?.dispose();
});

export async function createAlertFixture(options: { secondAccount?: boolean; migrationNames?: readonly string[] } = {}) {
  const fixture = await createD1Fixture();
  await applyMigrations(fixture.db, options.migrationNames ?? task18MigrationNames);
  await fixture.db.batch([
    fixture.db.prepare('INSERT INTO accounts (id, name, institution, currency, currency_mode, kind, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind('account-boc', 'Synthetic BOC card', 'BOC', 'CAD', 'multi', 'credit', 'connected'),
    fixture.db.prepare('INSERT OR IGNORE INTO account_currencies (account_id, currency) VALUES (?, ?)').bind('account-boc', 'CAD'),
    fixture.db.prepare('INSERT OR IGNORE INTO account_currencies (account_id, currency) VALUES (?, ?)').bind('account-boc', 'USD'),
    fixture.db.prepare('INSERT INTO source_profiles (id, ledger_id, provider, source_kind, display_name, parser_version, status, config_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind('source-boc', 'personal', 'boc', 'wechat', 'Synthetic BOC', 'parser-test-1', 'approved', '{}'),
    fixture.db.prepare('INSERT INTO mobile_devices (id, ledger_id, device_name, platform, status) VALUES (?, ?, ?, ?, ?)')
      .bind('capture-device', 'personal', 'Synthetic capture phone', 'android', 'paired'),
    fixture.db.prepare('INSERT INTO capture_credentials (id, device_id, credential_hash, credential_type, scope, generation, issued_at, expires_at, environment_hash, revocation_capability_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind('capture-credential', 'capture-device', await hashSecret(CAPTURE_SECRET), 'capture', 'alerts:write', 1, '2026-10-13T00:00:00.000Z', '2027-01-11T00:00:00.000Z', await hashSecret(ALERT_ENVIRONMENT), 'synthetic-revocation-hash'),
    fixture.db.prepare('INSERT INTO device_source_scopes (id, device_id, source_profile_id, account_id, currency, status) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('capture-scope-cad', 'capture-device', 'source-boc', 'account-boc', 'CAD', 'approved'),
  ]);
  if (options.secondAccount) {
    await fixture.db.batch([
      fixture.db.prepare('INSERT INTO accounts (id, name, institution, currency, currency_mode, kind, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind('account-other', 'Synthetic other card', 'Other Bank', 'CAD', 'single', 'credit', 'connected'),
      fixture.db.prepare('INSERT OR IGNORE INTO account_currencies (account_id, currency) VALUES (?, ?)').bind('account-other', 'CAD'),
    ]);
  }
  fixtures.push(fixture);
  return { ...fixture, db: fixture.db };
}

export function event(overrides: Partial<BankAlertEventInput> = {}): BankAlertEventInput {
  return {
    schemaVersion: 1,
    eventId: '00000000-0000-4000-8000-000000000001',
    observationId: 'observation-1',
    sourceProfileId: 'source-boc',
    parserVersion: 'parser-test-1',
    notificationPostedAt: '2026-10-13T04:00:00.000Z',
    capturedAt: '2026-10-13T04:00:01.000Z',
    eventTimeBasis: 'notification_posted',
    eventType: 'purchase_notice',
    direction: 'outflow',
    instrumentHint: null,
    eventMoney: { currency: 'CAD', amountMinor: 1234 },
    primaryMoneyRole: 'transaction',
    amounts: [{ role: 'transaction', currency: 'CAD', amountMinor: 1234 }],
    feeTreatment: 'included',
    bankReference: null,
    bankDisplayedTime: null,
    merchant: 'Synthetic merchant',
    completeness: { individualTimestamp: true, supportedSource: true, labeledMoney: true },
    ...overrides,
  };
}

export function mobileEnv(db: Awaited<ReturnType<typeof createAlertFixture>>['db']) {
  return {
    DB: db,
    LEDGER_APP_ORIGIN: ALERT_ORIGIN,
    MOBILE_ENVIRONMENT: ALERT_ENVIRONMENT,
    MOBILE_ACCESS_AUTHORIZATION_URL: 'https://access.example.com/authorize',
    MOBILE_SESSION_ENCRYPTION_KEY: ALERT_SESSION_KEY,
    ASSETS: { fetch: async () => new Response('not found', { status: 404 }) },
    LEDGER_API_KEY: 'legacy-key',
  };
}

export async function postAlerts(db: Awaited<ReturnType<typeof createAlertFixture>>['db'], events: readonly BankAlertEventInput[], credential = CAPTURE_SECRET) {
  const worker = (await import('../../worker/index')).default;
  return worker.fetch(new Request(`${ALERT_ORIGIN}/api/mobile/v1/alerts`, {
    method: 'POST',
    headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
    body: JSON.stringify({ events }),
  }), mobileEnv(db) as never);
}

