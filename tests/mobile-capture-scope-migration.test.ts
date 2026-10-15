import { afterEach, describe, expect, it } from 'vitest';
import registeredCurrencies from '../contracts/currencies.json';
import { applyMigrations, createD1Fixture, task15CurrencyMigrationNames, task15MigrationNames } from './helpers/d1';

const fixtures: Array<{ dispose(): Promise<void> }> = [];

afterEach(async () => {
  while (fixtures.length > 0) await fixtures.pop()?.dispose();
});

describe('capture-scope and currency migrations', () => {
  it('preserves legacy device scopes as explicit no-hint tuples and seeds every supported currency', async () => {
    const fixture = await createD1Fixture();
    fixtures.push(fixture);
    await applyMigrations(fixture.db, task15MigrationNames.slice(0, -1));
    await fixture.db.batch([
      fixture.db.prepare(`INSERT INTO accounts (id, name, institution, currency, currency_mode, kind, status)
        VALUES ('migration-account', 'Migration account', 'Synthetic bank', 'CAD', 'multi', 'credit', 'connected')`),
      fixture.db.prepare(`INSERT OR IGNORE INTO account_currencies (account_id, currency) VALUES ('migration-account', 'CAD')`),
      fixture.db.prepare(`INSERT INTO source_profiles (id, ledger_id, provider, source_kind, display_name, parser_version, status, config_json)
        VALUES ('migration-source', 'personal', 'synthetic', 'wechat', 'Migration source', 'test', 'approved', '{}')`),
      fixture.db.prepare(`INSERT INTO mobile_devices (id, ledger_id, device_name, platform, status)
        VALUES ('migration-device', 'personal', 'Migration device', 'android', 'paired')`),
      fixture.db.prepare(`INSERT INTO device_source_scopes (id, device_id, source_profile_id, account_id, currency, status)
        VALUES ('migration-scope', 'migration-device', 'migration-source', 'migration-account', 'CAD', 'approved')`),
    ]);

    await applyMigrations(fixture.db, task15CurrencyMigrationNames);

    await expect(fixture.db.prepare(`SELECT instrument_hint_kind, instrument_hint_value
      FROM device_source_scopes WHERE id = 'migration-scope'`).first()).resolves.toMatchObject({
      instrument_hint_kind: 'none',
      instrument_hint_value: '',
    });

    const rows = await fixture.db.prepare(`SELECT code, minor_unit_digits, display_name
      FROM currencies ORDER BY code`).all<{ code: string; minor_unit_digits: number; display_name: string }>();
    expect(rows.results).toHaveLength(registeredCurrencies.length);
    const byCode = new Map(rows.results.map((row) => [row.code, row]));
    for (const currency of registeredCurrencies) {
      expect(byCode.get(currency.code)).toMatchObject({
        code: currency.code,
        minor_unit_digits: currency.minorUnitDigits,
      });
      expect(byCode.get(currency.code)?.display_name).toBeTruthy();
    }
  });
});
