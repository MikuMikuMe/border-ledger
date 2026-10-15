import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const gradle = readFileSync(resolve(root, 'android/app/build.gradle.kts'), 'utf8');
const releaseWorkflow = readFileSync(resolve(root, '.github/workflows/android-release.yml'), 'utf8');
const deployWorkflow = readFileSync(resolve(root, '.github/workflows/deploy.yml'), 'utf8');
const wrangler = readFileSync(resolve(root, 'wrangler.jsonc'), 'utf8');

describe('release automation contract', () => {
  it('allows CI to provide a deterministic Android version while preserving local defaults', () => {
    expect(gradle).toContain('gradleProperty("releaseVersionCode")');
    expect(gradle).toContain('gradleProperty("releaseVersionName")');
    expect(gradle).toContain('versionCode = releaseVersionCode');
    expect(gradle).toContain('versionName = releaseVersionName');
  });

  it('publishes an Android release only from app-owned changes on main', () => {
    expect(releaseWorkflow).toMatch(/push:\s*\n\s+branches:\s*\[main\]/);
    expect(releaseWorkflow).toContain('android/**');
    expect(releaseWorkflow).toContain('src/**');
    expect(releaseWorkflow).toContain('contracts/**');
    expect(releaseWorkflow).toContain('package.json');
    expect(releaseWorkflow).toContain('package-lock.json');
    expect(releaseWorkflow).toContain('Distinguish app changes from backend-only package changes');
    expect(releaseWorkflow).toContain('detect-android-release-change.mjs');
    expect(releaseWorkflow).toContain("needs.detect-app-change.outputs.app_changed == 'true'");
    expect(releaseWorkflow).toContain("github.ref == 'refs/heads/main'");
    expect(releaseWorkflow).toContain('if-no-files-found: error');
    expect(releaseWorkflow).toContain('contents: write');
    expect(releaseWorkflow).toContain('assembleRelease');
    expect(releaseWorkflow).toContain('apksigner');
    expect(releaseWorkflow).toContain('dump xmltree --file AndroidManifest.xml');
    expect(releaseWorkflow).toContain('gh release');
    expect(releaseWorkflow).toContain('ANDROID_KEYSTORE_BASE64');
    expect(releaseWorkflow).toContain('releaseVersionCode');
    expect(releaseWorkflow).toContain('releaseVersionName');
    expect(releaseWorkflow).toContain('"-PreleaseVersionCode=');
    expect(releaseWorkflow).toContain('"-PreleaseVersionName=');
  });

  it('deploys the named Cloudflare production environment and fails closed on missing credentials', () => {
    expect(deployWorkflow).toContain('CLOUDFLARE_API_TOKEN');
    expect(deployWorkflow).toContain('CLOUDFLARE_ACCOUNT_ID');
    expect(deployWorkflow).toContain('Missing required Cloudflare deployment secret');
    expect(deployWorkflow).toContain('d1 migrations apply border-ledger-production --remote --env production');
    expect(deployWorkflow).toContain('MOBILE_SESSION_ENCRYPTION_KEY');
    expect(deployWorkflow).toContain('command: deploy --env production --keep-vars --var');
    expect(deployWorkflow).toContain('deploymentRevision');
    expect(deployWorkflow).toContain('mobileAuthConfigured');
    expect(deployWorkflow).not.toContain('configured=false');
    expect(deployWorkflow).not.toContain('deployment skipped');
  });

  it('targets the existing production custom-domain Worker instead of creating a shadow Worker', () => {
    expect(wrangler).toContain('"name": "border-ledger"');
    expect(wrangler).not.toContain('"name": "border-ledger-production"');
    expect(wrangler).toContain('"production": {');
    expect(wrangler).toContain('"MOBILE_ACCESS_AUTHORIZATION_URL": "https://pf.lofuyu.com/mobile/authorize"');
  });
});
