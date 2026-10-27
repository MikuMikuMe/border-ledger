import { vi } from 'vitest';
import type { D1Database } from '../../worker/db-types';

// These route tests exercise financial contracts after the external JWT verifier.
// The dedicated web authentication suite covers rejection and real signatures.
vi.mock('jose', async (original) => {
  const actual = await original<typeof import('jose')>();
  return { ...actual, jwtVerify: async (assertion: string) => {
    if (assertion !== 'fixture-verified-owner') throw new Error('Invalid fixture assertion');
    return { payload: { sub: 'fixture-owner', aud: 'fixture-audience', iss: 'https://fixture.cloudflareaccess.com' } };
  } };
});
export const VERIFIED_WEB_ENV = { ACCESS_TEAM_DOMAIN: 'https://fixture.cloudflareaccess.com', ACCESS_AUDIENCE: 'fixture-audience' };
export const VERIFIED_WEB_HEADERS = { 'Cf-Access-Jwt-Assertion': 'fixture-verified-owner' };
export async function provisionWebOwner(db: D1Database) {
  await db.prepare("INSERT INTO user_identities(issuer,subject,user_id) VALUES ('https://fixture.cloudflareaccess.com','fixture-owner','owner')").run();
}
