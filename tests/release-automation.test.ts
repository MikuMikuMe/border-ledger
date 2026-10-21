import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const gradle = readFileSync(resolve(root, 'android/app/build.gradle.kts'), 'utf8');
const releaseWorkflow = readFileSync(resolve(root, '.github/workflows/android-release.yml'), 'utf8');
const codeqlWorkflow = readFileSync(resolve(root, '.github/workflows/codeql.yml'), 'utf8');
const androidCiWorkflow = readFileSync(resolve(root, '.github/workflows/android-ci.yml'), 'utf8');
const extractActionRefs = (source: string) =>
  [...source.matchAll(/^[ \t]*-?[ \t]*uses:[ \t]+([^\s#]+)/gm)].map((match) => match[1]);
const promotionPath = resolve(root, '.github/workflows/android-promote.yml');
const promotionWorkflow = existsSync(promotionPath) ? readFileSync(promotionPath, 'utf8') : '';
const deployWorkflow = readFileSync(resolve(root, '.github/workflows/deploy.yml'), 'utf8');
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

  it('blocks debug packaging when its keystore uses the protected production certificate', () => {
    expect(gradle).toContain('verifyDebugSigningIdentity');
    expect(gradle).toContain('getCertificate(debugKeyAlias)');
    expect(gradle).toContain('1FF2A25E39136EEFA79D23CC7531F702B2A162280538410509CA2FF65B4744ED');
    expect(gradle).toContain('validateSigningDebug');
    expect(gradle).toMatch(/it\.name\.startsWith\("packageDebug"\)/);
    expect(gradle).toMatch(/it\.name\.startsWith\("signDebug"\)/);
    expect(gradle).toContain('borderLedgerDebugKeystore');
    expect(gradle).not.toContain('validateSigningRelease');
    expect(gradle).not.toContain('packageRelease');
  });

  it('builds unsigned APKs on app pushes and reserves signing for a reviewed main SHA', () => {
    expect(releaseWorkflow).toMatch(/^  workflow_dispatch:/m);
    expect(releaseWorkflow).toMatch(/^  push:\s*\n\s+branches:\s+\[main\]\s*\n\s+paths:/m);
    expect(releaseWorkflow).toContain('mobile/**');
    expect(releaseWorkflow).toContain('inputs.source_sha || github.sha');
    expect(releaseWorkflow).toContain('group: android-release-candidate-${{ github.event_name }}-${{ github.sha }}');
    expect(releaseWorkflow).toContain('source_sha');
    expect(releaseWorkflow).toContain('must equal the workflow main SHA');
    const buildJob = releaseWorkflow.split('  sign-artifact:')[0];
    expect(buildJob).toContain('build-unsigned:');
    expect(buildJob).toContain('assembleRelease');
    expect(buildJob).toContain('releaseVersionCode=1000');
    expect(buildJob).toContain('releaseVersionName=0.2.0');
    expect(buildJob).toContain('mobileEnvironment=production');
    expect(buildJob).toContain('actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02');
    expect(buildJob).not.toMatch(/secrets\./);
    expect(buildJob).not.toContain('contents: write');
  });

  it('signs main builds with the protected environment and reserves release publishing for manual dispatch', () => {
    const signer = releaseWorkflow.split('  sign-artifact:')[1]?.split('  create-candidate-draft:')[0] ?? '';
    expect(signer).toContain("if: github.ref == 'refs/heads/main'");
    expect(signer).toContain('environment: android-production-signing');
    expect(signer).toContain('actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093');
    expect(signer).toContain('apksigner sign');
    expect(signer).toContain('EXPECTED_CERT_SHA256');
    expect(signer).toContain('android-signed-${{ github.run_id }}');
    expect(signer).toContain('actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02');
    expect(signer).toContain('candidate-manifest.json');
    expect(signer).not.toContain('actions/checkout');
    expect(signer).not.toContain('contents: write');
    expect(signer).not.toContain('gh release create');
  });

  it('creates a draft release only from a manual main-branch dispatch', () => {
    const draftRelease = releaseWorkflow.split('  create-candidate-draft:')[1] ?? '';
    expect(draftRelease).toContain("github.ref == 'refs/heads/main' && github.event_name == 'workflow_dispatch'");
    expect(draftRelease).toContain('contents: write');
    expect(draftRelease).toContain('gh release create');
    expect(draftRelease).toContain('--draft');
    expect(draftRelease).not.toContain('--clobber');
  });

  it('promotes the accepted draft by verifying the exact source and APK hash without rebuilding or replacing bytes', () => {
    expect(promotionWorkflow).toMatch(/^  workflow_dispatch:/m);
    expect(promotionWorkflow).toContain("github.ref == 'refs/heads/main'");
    expect(promotionWorkflow).toContain('candidate-manifest.json');
    expect(promotionWorkflow).toContain('SOURCE_SHA');
    expect(promotionWorkflow).toContain('SHA256SUMS.txt');
    expect(promotionWorkflow).toContain('gh release edit');
    expect(promotionWorkflow).toContain('--draft=false');
    expect(promotionWorkflow).not.toContain('actions/checkout');
    expect(promotionWorkflow).not.toContain('assembleRelease');
    expect(promotionWorkflow).not.toContain('apksigner sign');
    expect(promotionWorkflow).not.toContain('--clobber');
  });

  it('removes private owner acceptance evidence before making the release public', () => {
    const deletionIndex = promotionWorkflow.indexOf('gh release delete-asset');
    const publishIndex = promotionWorkflow.indexOf('--draft=false');

    expect(deletionIndex).toBeGreaterThan(-1);
    expect(deletionIndex).toBeLessThan(publishIndex);
    expect(promotionWorkflow).toContain('acceptance-manifest.json');
    expect(promotionWorkflow).toContain('acceptance-evidence.zip');
  });

  it('records an acceptance marker before private-asset cleanup so promotion can resume', () => {
    const markerIndex = promotionWorkflow.indexOf('border-ledger-acceptance:v1');
    const deletionIndex = promotionWorkflow.indexOf('gh release delete-asset');

    expect(markerIndex).toBeGreaterThan(-1);
    expect(markerIndex).toBeLessThan(deletionIndex);
    expect(promotionWorkflow).toContain('--notes-file');
    expect(promotionWorkflow).toContain('if ($assetNames -contains $assetName)');
  });

  it('uses gh api endpoints without the unsupported --repo flag', () => {
    const apiCalls = promotionWorkflow.split('\n').filter(line => line.includes('gh api'));
    expect(apiCalls.length).toBeGreaterThan(0);
    expect(apiCalls.every(line => !line.includes('gh api --repo'))).toBe(true);
    expect(apiCalls.every(line => line.includes('repos/$env:GITHUB_REPOSITORY/'))).toBe(true);
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

  it('verifies the production Android App Links response against the existing release signer after deployment', () => {
    expect(deployWorkflow).toContain('https://pf.lofuyu.com/.well-known/assetlinks.json');
    expect(deployWorkflow).toContain('sha256_cert_fingerprints');
    expect(deployWorkflow).toContain('1F:F2:A2:5E:39:13:6E:EF:A7:9D:23:CC:75:31:F7:02:B2:A1:62:28:05:38:41:05:09:CA:2F:F6:5B:47:44:ED');
    expect(deployWorkflow.indexOf('Deploy the named production Worker')).toBeLessThan(
      deployWorkflow.indexOf('https://pf.lofuyu.com/.well-known/assetlinks.json'),
    );
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
