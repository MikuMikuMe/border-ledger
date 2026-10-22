import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const gradle = readFileSync(resolve(root, 'android/app/build.gradle.kts'), 'utf8');
const releaseWorkflow = readFileSync(resolve(root, '.github/workflows/android-release.yml'), 'utf8');
const codeqlWorkflow = readFileSync(resolve(root, '.github/workflows/codeql.yml'), 'utf8');
const androidCiWorkflow = readFileSync(resolve(root, '.github/workflows/android-ci.yml'), 'utf8');
const extractActionRefs = (source: string) =>
  [...source.matchAll(/^[ \t]*-?[ \t]*uses:[ \t]+([^\s#]+)/gm)].map((match) => match[1]);
const deployWorkflow = readFileSync(resolve(root, '.github/workflows/deploy.yml'), 'utf8');
const assetLinks = readFileSync(resolve(root, 'public/.well-known/assetlinks.json'), 'utf8');
const workerSource = readFileSync(resolve(root, 'worker/index.ts'), 'utf8');
const acceptanceVerifier = readFileSync(resolve(root, 'scripts/verify-android-acceptance.mjs'), 'utf8');
const productionAppLinksVerifier = readFileSync(resolve(root, 'scripts/verify-production-app-links.mjs'), 'utf8');
const androidValidationDocs = readFileSync(resolve(root, 'docs/android-validation.md'), 'utf8');
const wrangler = readFileSync(resolve(root, 'wrangler.jsonc'), 'utf8');
const wranglerConfig = JSON.parse(wrangler);
const productionConfig = wranglerConfig.env.production;
const workflowSources = readdirSync(resolve(root, '.github/workflows'))
  .filter((file) => file.endsWith('.yml'))
  .map((file) => readFileSync(resolve(root, '.github/workflows', file), 'utf8'));

describe('release automation contract', () => {
  it('allows CI to provide a deterministic Android version while preserving local defaults', () => {
    expect(gradle).toContain('gradleProperty("releaseVersionCode")');
    expect(gradle).toContain('gradleProperty("releaseVersionName")');
    expect(gradle).toContain('versionCode = releaseVersionCode');
    expect(gradle).toContain('versionName = releaseVersionName');
    expect(gradle).toContain('gradleProperty("mobileEnvironment")');
    expect(gradle).toContain('buildConfigField("String", "MOBILE_ENVIRONMENT"');
  });

  it('blocks debug packaging when its keystore uses either production signer', () => {
    expect(gradle).toContain('verifyDebugSigningIdentity');
    expect(gradle).toContain('getCertificate(debugKeyAlias)');
    expect(gradle).toContain('5827E817EBAD9D478CA2C3C470A3742D783FC7D2BFBFFB8CC58219B5F3E68417');
    expect(gradle).toContain('1FF2A25E39136EEFA79D23CC7531F702B2A162280538410509CA2FF65B4744ED');
    expect(gradle).toContain('actualFingerprint in protectedProductionSigningCertificatesSha256');
    expect(gradle).toContain('validateSigningDebug');
    expect(gradle).toMatch(/it\.name\.startsWith\("packageDebug"\)/);
    expect(gradle).toMatch(/it\.name\.startsWith\("signDebug"\)/);
    expect(gradle).toContain('borderLedgerDebugKeystore');
    expect(gradle).not.toContain('validateSigningRelease');
    expect(gradle).not.toContain('packageRelease');
  });

  it('gates release builds on app changes and reserves signing for a reviewed main SHA', () => {
    expect(releaseWorkflow).toMatch(/^  workflow_dispatch:/m);
    expect(releaseWorkflow).toMatch(/^  push:\s*\n\s+branches:\s+\[main\]\s*\n\s+paths:/m);
    expect(releaseWorkflow).toContain('mobile/**');
    expect(releaseWorkflow).toContain('android/**');
    expect(releaseWorkflow).not.toContain('tests/**');
    expect(releaseWorkflow).not.toContain('.github/workflows/android-release.yml');
    expect(releaseWorkflow).toContain('node scripts/detect-android-release-change.mjs');
    expect(releaseWorkflow).toContain('node scripts/resolve-android-release-version.mjs');
    expect(releaseWorkflow).toContain("needs.detect-app-change.outputs.app_changed == 'true'");
    expect(releaseWorkflow).toContain('inputs.source_sha || github.sha');
    expect(releaseWorkflow).toContain('group: android-release-${{ github.ref }}');
    expect(releaseWorkflow).toContain('source_sha');
    expect(releaseWorkflow).toContain('must equal the workflow main SHA');
    const buildJob = releaseWorkflow.split('  sign-artifact:')[0];
    expect(buildJob).toContain('build-unsigned:');
    expect(buildJob).toContain('assembleRelease');
    expect(buildJob).toContain('-PreleaseVersionCode=${{ needs.detect-app-change.outputs.version_code }}');
    expect(buildJob).toContain('-PreleaseVersionName=${{ needs.detect-app-change.outputs.version_name }}');
    expect(buildJob).toContain('mobileEnvironment=production');
    expect(buildJob).toContain('actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02');
    expect(buildJob).not.toMatch(/secrets\./);
    expect(buildJob).not.toContain('contents: write');
  });

  it('signs app builds with the protected environment and reserves release asset writes for the publishing job', () => {
    const signer = releaseWorkflow.split('  sign-artifact:')[1]?.split('  publish-release:')[0] ?? '';
    expect(signer).toContain("if: github.ref == 'refs/heads/main'");
    expect(signer).toContain('environment: android-production-signing');
    expect(signer).toContain('actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333');
    expect(signer).toContain('apksigner sign');
    expect(signer).toContain('EXPECTED_CERT_SHA256');
    expect(signer).toContain('EXPECTED_CERT_SHA256: 5827e817ebad9d478ca2c3c470a3742d783fc7d2bfbffb8cc58219b5f3e68417');
    expect(signer).toContain('Release certificate does not match the GitHub signing key fingerprint.');
    expect(signer).toContain('android-signed-${{ github.run_id }}');
    expect(signer).toContain('actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02');
    expect(signer).toContain('release-manifest.json');
    expect(signer).not.toContain('actions/checkout');
    expect(signer).not.toContain('contents: write');
    expect(signer).not.toContain('gh release create');
  });

  it('publishes a normal release for app pushes and manual main-branch dispatches with app-focused change notes', () => {
    const publishedRelease = releaseWorkflow.split('  publish-release:')[1] ?? '';
    expect(publishedRelease).toContain("github.ref == 'refs/heads/main' && needs.detect-app-change.outputs.app_changed == 'true'");
    expect(publishedRelease).toContain('contents: write');
    expect(publishedRelease).toContain('gh release create');
    expect(publishedRelease).toContain('releases/generate-notes');
    expect(publishedRelease).toContain('PREVIOUS_TAG');
    expect(publishedRelease).not.toContain('--draft');
    expect(publishedRelease).not.toContain('--prerelease');
    expect(publishedRelease).not.toContain('--clobber');
  });

  it('recognizes shorthand action steps before checking every immutable pin', () => {
    const androidCheckoutRefs = extractActionRefs(androidCiWorkflow).filter((ref) => ref.startsWith('actions/checkout@'));
    expect(androidCheckoutRefs.some((ref) => /^actions\/checkout@[a-f0-9]{40}$/i.test(ref))).toBe(true);

    const actionRefs = workflowSources.flatMap((source) => extractActionRefs(source));
    expect(actionRefs.length).toBeGreaterThan(0);
    expect(actionRefs.filter((ref) => !/@[a-f0-9]{40}$/i.test(ref))).toEqual([]);
  });

  it('builds the Java/Kotlin CodeQL database with the production debug variant', () => {
    expect(codeqlWorkflow).toContain('build-mode: manual');
    expect(codeqlWorkflow).toContain(':app:assembleDebug');
    expect(codeqlWorkflow).toContain('-PmobileEnvironment=production');
    expect(codeqlWorkflow).toContain('platforms;android-37.0');
    expect(codeqlWorkflow).toContain('npm ci');
  });

  it('deploys the existing Cloudflare production Worker and fails closed on missing credentials', () => {
    expect(deployWorkflow).toContain('CLOUDFLARE_API_TOKEN');
    expect(deployWorkflow).not.toContain('CLOUDFLARE_ACCOUNT_ID');
    expect(deployWorkflow).toContain('Missing required Cloudflare deployment secret');
    expect(deployWorkflow).toContain('d1 migrations apply border-ledger --remote --env production');
    expect(deployWorkflow).not.toContain('border-ledger-production');
    expect(deployWorkflow).toContain('MOBILE_SESSION_ENCRYPTION_KEY');
    expect(deployWorkflow).toContain('MOBILE_APPROVED_ACCESS_ISSUERS');
    expect(deployWorkflow).toContain('MOBILE_APPROVED_ACCESS_AUDIENCES');
    expect(deployWorkflow).toContain('MOBILE_APPROVED_ACCESS_SUBJECTS');
    expect(deployWorkflow).toContain('Missing required production Worker secret');
    expect(deployWorkflow).toContain('CLOUDFLARE_ACCESS_CLIENT_ID');
    expect(deployWorkflow).toContain('CLOUDFLARE_ACCESS_CLIENT_SECRET');
    expect(deployWorkflow).toContain('CF-Access-Client-Id');
    expect(deployWorkflow).toContain('CF-Access-Client-Secret');
    expect(deployWorkflow).toContain('command: deploy --env production --keep-vars --var');
    expect(deployWorkflow).toContain('deploymentRevision');
    expect(deployWorkflow).toContain('mobileAuthConfigured');
    expect(deployWorkflow).not.toContain('configured=false');
    expect(deployWorkflow).not.toContain('deployment skipped');
  });

  it('runs the retrying production App Links verifier after deployment', () => {
    expect(deployWorkflow).toContain('node scripts/verify-production-app-links.mjs');
    expect(deployWorkflow).toContain('GITHUB_SHA: ${{ github.sha }}');
    expect(productionAppLinksVerifier).toContain('https://pf.lofuyu.com/.well-known/assetlinks.json');
    expect(productionAppLinksVerifier).toContain('58:27:E8:17:EB:AD:9D:47:8C:A2:C3:C4:70:A3:74:2D:78:3F:C7:D2:BF:BF:FB:8C:C5:82:19:B5:F3:E6:84:17');
    expect(productionAppLinksVerifier).toContain('1F:F2:A2:5E:39:13:6E:EF:A7:9D:23:CC:75:31:F7:02:B2:A1:62:28:05:38:41:05:09:CA:2F:F6:5B:47:44:ED');
    expect(deployWorkflow.indexOf('Deploy the named production Worker')).toBeLessThan(
      deployWorkflow.indexOf('node scripts/verify-production-app-links.mjs'),
    );
  });

  it('uses the GitHub signing key for releases and both expected signers for App Links', () => {
    const expectedCompact = '5827e817ebad9d478ca2c3c470a3742d783fc7d2bfbffb8cc58219b5f3e68417';
    const expectedDisplay = '58:27:E8:17:EB:AD:9D:47:8C:A2:C3:C4:70:A3:74:2D:78:3F:C7:D2:BF:BF:FB:8C:C5:82:19:B5:F3:E6:84:17';
    const signingSources = releaseWorkflow.toLowerCase();

    expect(gradle).toContain(expectedCompact.toUpperCase());
    expect(releaseWorkflow).toContain(`EXPECTED_CERT_SHA256: ${expectedCompact}`);
    for (const source of [productionAppLinksVerifier, assetLinks, workerSource]) {
      expect(source).toContain(expectedDisplay);
    }
    expect(signingSources).not.toContain('1f:f2');
    expect(signingSources).not.toContain('44:ed');
  });
  it('targets the existing production Worker bindings instead of creating a shadow Worker', () => {
    expect(wranglerConfig.name).toBe('border-ledger-local');
    expect(wranglerConfig.workers_dev).toBe(false);
    expect(wranglerConfig.vars.PLAID_ENV).toBe('production');
    expect(wranglerConfig.vars.LEDGER_APP_ORIGIN).toBe('http://localhost:8787');
    expect(wranglerConfig.vars).not.toHaveProperty('PLAID_WEBHOOK_URL');
    expect(wranglerConfig.d1_databases[0]).toMatchObject({
      binding: 'DB',
      database_name: 'border-ledger-local',
      database_id: '00000000-0000-0000-0000-000000000000',
    });
    expect(wranglerConfig.queues.producers[0].queue).toBe('border-ledger-local-sync');

    expect(wranglerConfig.account_id).toBe('a0af41818e1b715f66046b0d7870ce70');
    expect(productionConfig.name).toBe('border-ledger');
    expect(productionConfig.vars.PLAID_ENV).toBe('production');
    expect(productionConfig.d1_databases[0]).toMatchObject({
      binding: 'DB',
      database_name: 'border-ledger',
      database_id: '14378887-f604-4d04-95f1-26930405b5a8',
    });
    expect(productionConfig.queues.producers[0].queue).toBe('border-ledger-sync');
    expect(productionConfig.vars.MOBILE_ACCESS_AUTHORIZATION_URL).toBe('https://pf.lofuyu.com/mobile/authorize');
  });
});
