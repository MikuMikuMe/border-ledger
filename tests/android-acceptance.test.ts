import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { verifyAndroidAcceptance as verifyAndroidAcceptanceType } from '../scripts/verify-android-acceptance.mjs';

type Assert<T extends true> = T;
type AndroidAcceptanceResult = Awaited<ReturnType<typeof verifyAndroidAcceptanceType>>;
type InstallationModeContract = Assert<
  AndroidAcceptanceResult['installationMode'] extends 'in-place-upgrade' | 'fresh-install'
    ? 'in-place-upgrade' extends AndroidAcceptanceResult['installationMode']
      ? 'fresh-install' extends AndroidAcceptanceResult['installationMode'] ? true : false
      : false
    : false
>;

const packageId = 'com.lofuyu.borderledger';
const assetLinksUrl = 'https://pf.lofuyu.com/.well-known/assetlinks.json';
const sourceSha = 'a'.repeat(40);
const apkSha256 = 'b'.repeat(64);
const certificateSha256 = '58:27:E8:17:EB:AD:9D:47:8C:A2:C3:C4:70:A3:74:2D:78:3F:C7:D2:BF:BF:FB:8C:C5:82:19:B5:F3:E6:84:17';
const temporaryDirectories: string[] = [];

type InstallationAcceptance = {
  mode: 'in-place-upgrade' | 'fresh-install';
  status: 'passed';
  packageId: string;
  signingCertificateSha256: string;
  fromVersionCode?: number;
  toVersionCode?: number;
  previousSigningCertificateSha256?: string;
  versionCode?: number;
  dataDisposition?: string;
  evidence: ReturnType<typeof writeEvidence>;
};

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function writeEvidence(directory: string, path: string, content: Buffer | string) {
  const fullPath = join(directory, path);
  writeFileSync(fullPath, content);
  return { path, sha256: sha256(Buffer.isBuffer(content) ? content : Buffer.from(content)) };
}

function attestEvidence(evidence: ReturnType<typeof writeEvidence>, gateId: string) {
  return {
    ...evidence,
    attestation: {
      sourceSha,
      gateId,
      capturedAt: new Date(Date.now() - 60_000).toISOString(),
      device: 'Pixel 10 Pro API 37',
      evidenceType: 'test-report',
    },
  };
}

function validAssetLinks(certificate = certificateSha256) {
  return JSON.stringify([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: packageId,
      sha256_cert_fingerprints: [certificate],
    },
  }]);
}

function createAcceptanceFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'border-ledger-acceptance-'));
  temporaryDirectories.push(directory);

  const assetLinksBody = validAssetLinks();
  const appLinksEvidence = writeEvidence(directory, 'assetlinks.json', assetLinksBody);
  const upgradeEvidenceBody = JSON.stringify({
    packageId,
    fromVersionCode: 999,
    toVersionCode: 1000,
    signingCertificateSha256: certificateSha256,
    upgradedExistingInstallation: true,
    existingAppDataPreserved: true,
  });
  const upgradeEvidence = writeEvidence(directory, 'upgrade.json', upgradeEvidenceBody);
  const installationAcceptance: InstallationAcceptance = {
    mode: 'in-place-upgrade',
    status: 'passed',
    packageId,
    signingCertificateSha256: certificateSha256,
    fromVersionCode: 999,
    toVersionCode: 1000,
    evidence: upgradeEvidence,
  };
  const gates = Object.fromEntries(Array.from({ length: 18 }, (_, index) => {
    const id = 'F' + String(index + 1).padStart(2, '0');
    const evidence = writeEvidence(directory, id + '.txt', 'sanitized acceptance evidence for ' + id);
    return [id, { status: 'passed', evidence: [attestEvidence(evidence, id)] }];
  }));

  const manifestPath = join(directory, 'acceptance-manifest.json');
  const manifest = {
    schemaVersion: 2,
    sourceSha,
    apkSha256,
    packageId,
    mobileEnvironment: 'production',
    signingCertificateSha256: certificateSha256,
    versionCode: 1000,
    appLinks: {
      status: 'passed',
      url: assetLinksUrl,
      packageId,
      signingCertificateSha256: certificateSha256,
      responseSha256: appLinksEvidence.sha256,
      responseEvidence: appLinksEvidence,
    },
    installationAcceptance,
    gates,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest));

  return { directory, manifestPath, manifest, assetLinksBody };
}

function configureFreshInstallAcceptance(fixture: ReturnType<typeof createAcceptanceFixture>) {
  const previousSigningCertificateSha256 = '11'.repeat(32);
  const freshInstallEvidence = writeEvidence(fixture.directory, 'fresh-install.json', JSON.stringify({
    packageId,
    previousSigningCertificateSha256,
    signingCertificateSha256: certificateSha256,
    versionCode: 1000,
    freshInstallCompleted: true,
    previousAppAbsent: true,
    dataDisposition: 'no-existing-data',
  }));
  fixture.manifest.installationAcceptance = {
    mode: 'fresh-install',
    status: 'passed',
    packageId,
    previousSigningCertificateSha256,
    signingCertificateSha256: certificateSha256,
    versionCode: 1000,
    dataDisposition: 'no-existing-data',
    evidence: freshInstallEvidence,
  };
  writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest));
  return fixture;
}

function testFetch(body: string) {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));
}

async function verify(fixture: ReturnType<typeof createAcceptanceFixture>, options: {
  expectedSourceSha?: string;
  liveAssetLinksBody?: string;
} = {}) {
  const { verifyAndroidAcceptance } = await import('../scripts/verify-android-acceptance.mjs');
  return verifyAndroidAcceptance({
    manifestPath: fixture.manifestPath,
    evidenceDirectory: fixture.directory,
    expectedSourceSha: options.expectedSourceSha ?? sourceSha,
    expectedApkSha256: apkSha256,
    expectedSigningCertificateSha256: certificateSha256,
    expectedVersionCode: 1000,
    fetchImpl: testFetch(options.liveAssetLinksBody ?? fixture.assetLinksBody),
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('Android release acceptance evidence', () => {
  it('accepts a source-bound F01–F18 record only when device and live App Links evidence agree', async () => {
    const fixture = createAcceptanceFixture();

    await expect(verify(fixture)).resolves.toEqual({
      verified: true,
      featureGateCount: 18,
      installationMode: 'in-place-upgrade',
    });
  });

  it('accepts a fresh install when the candidate uses a different signing key', async () => {
    const fixture = configureFreshInstallAcceptance(createAcceptanceFixture());

    await expect(verify(fixture)).resolves.toEqual({
      verified: true,
      featureGateCount: 18,
      installationMode: 'fresh-install',
    });
  });

  it('reports fresh-install acceptance accurately in CLI output', () => {
    const fixture = configureFreshInstallAcceptance(createAcceptanceFixture());
    const fetchShimPath = resolve(process.cwd(), 'tests/helpers/android-acceptance-fetch-shim.mjs');

    const result = spawnSync(process.execPath, [
      '--import', pathToFileURL(fetchShimPath).href,
      resolve(process.cwd(), 'scripts/verify-android-acceptance.mjs'),
      '--manifest', fixture.manifestPath,
      '--evidence-dir', fixture.directory,
      '--source-sha', sourceSha,
      '--apk-sha256', apkSha256,
      '--signing-cert-sha256', certificateSha256,
      '--version-code', '1000',
    ], {
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        ...process.env,
        ANDROID_ACCEPTANCE_ASSET_LINKS_BODY: fixture.assetLinksBody,
      },
    });

    expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0);
    expect(result.stdout).toContain('fresh install.');
    expect(result.stdout).not.toContain('in-place upgrade');
  });

  it('rejects fresh-install acceptance when the previous certificate matches the candidate', async () => {
    const fixture = configureFreshInstallAcceptance(createAcceptanceFixture());
    fixture.manifest.installationAcceptance.previousSigningCertificateSha256 = certificateSha256;
    writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest));

    await expect(verify(fixture)).rejects.toThrow('Fresh-install acceptance requires a different previous signing certificate');
  });

  it('requires an explicit data disposition for fresh-install acceptance', async () => {
    const fixture = configureFreshInstallAcceptance(createAcceptanceFixture());
    fixture.manifest.installationAcceptance.dataDisposition = 'unrecorded';
    writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest));

    await expect(verify(fixture)).rejects.toThrow('Fresh-install dataDisposition must be "backup-verified" or "no-existing-data"');
  });

  it('rejects a pending feature gate even when it has a file attached', async () => {
    const fixture = createAcceptanceFixture();
    fixture.manifest.gates.F18.status = 'pending';
    writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest));

    await expect(verify(fixture)).rejects.toThrow('F18 must be passed');
  });

  it('rejects evidence whose bytes no longer match the recorded digest', async () => {
    const fixture = createAcceptanceFixture();
    writeFileSync(join(fixture.directory, 'F18.txt'), 'changed after acceptance');

    await expect(verify(fixture)).rejects.toThrow('evidence checksum mismatch');
  });

  it('rejects empty evidence even when its empty-file digest is correct', async () => {
    const fixture = createAcceptanceFixture();
    const emptyEvidence = writeEvidence(fixture.directory, 'F18-empty.txt', '');
    fixture.manifest.gates.F18.evidence = [attestEvidence(emptyEvidence, 'F18')];
    writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest));

    await expect(verify(fixture)).rejects.toThrow('F18 evidence 1 must not be empty');
  });

  it('requires each gate evidence attestation to bind source, gate, capture time, device, and evidence type', async () => {
    const fixture = createAcceptanceFixture();
    fixture.manifest.gates.F18.evidence[0].attestation.sourceSha = 'c'.repeat(40);
    writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest));

    await expect(verify(fixture)).rejects.toThrow('F18 evidence 1 attestation source SHA does not match');
  });

  it('rejects gate evidence with an incomplete capture attestation', async () => {
    const fixture = createAcceptanceFixture();
    fixture.manifest.gates.F18.evidence[0].attestation.device = '  ';
    writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest));

    await expect(verify(fixture)).rejects.toThrow('F18 evidence 1 attestation device must be a non-empty string');
  });

  it('rejects evidence attributed to a different feature gate', async () => {
    const fixture = createAcceptanceFixture();
    fixture.manifest.gates.F18.evidence[0].attestation.gateId = 'F01';
    writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest));

    await expect(verify(fixture)).rejects.toThrow('F18 evidence 1 attestation gate ID does not match');
  });

  it('rejects malformed or future capture timestamps', async () => {
    const malformed = createAcceptanceFixture();
    malformed.manifest.gates.F18.evidence[0].attestation.capturedAt = 'not-a-timestamp';
    writeFileSync(malformed.manifestPath, JSON.stringify(malformed.manifest));
    await expect(verify(malformed)).rejects.toThrow('F18 evidence 1 attestation capture time must be a valid UTC ISO-8601 timestamp');

    const future = createAcceptanceFixture();
    future.manifest.gates.F18.evidence[0].attestation.capturedAt = new Date(Date.now() + 60 * 60_000).toISOString();
    writeFileSync(future.manifestPath, JSON.stringify(future.manifest));
    await expect(verify(future)).rejects.toThrow('F18 evidence 1 attestation capture time cannot be in the future');
  });

  it('rejects acceptance evidence captured more than 30 days ago', async () => {
    const fixture = createAcceptanceFixture();
    fixture.manifest.gates.F18.evidence[0].attestation.capturedAt = new Date(Date.now() - 31 * 24 * 60 * 60_000).toISOString();
    writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest));

    await expect(verify(fixture)).rejects.toThrow('F18 evidence 1 attestation capture time is older than 30 days');
  });

  it('requires an evidence type with a lowercase slug', async () => {
    const fixture = createAcceptanceFixture();
    fixture.manifest.gates.F18.evidence[0].attestation.evidenceType = 'Screen capture';
    writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest));

    await expect(verify(fixture)).rejects.toThrow('F18 evidence 1 attestation evidence type must be a lowercase slug');
  });

  it('rejects one evidence file reused to claim multiple feature gates', async () => {
    const fixture = createAcceptanceFixture();
    fixture.manifest.gates.F18.evidence = fixture.manifest.gates.F01.evidence;
    writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest));

    await expect(verify(fixture)).rejects.toThrow('F18 evidence reuses a file already assigned to F01');
  });

  it('rejects duplicated evidence content under different paths', async () => {
    const fixture = createAcceptanceFixture();
    const duplicateEvidence = writeEvidence(fixture.directory, 'F18-copy.txt', 'sanitized acceptance evidence for F01');
    fixture.manifest.gates.F18.evidence = [attestEvidence(duplicateEvidence, 'F18')];
    writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest));

    await expect(verify(fixture)).rejects.toThrow('F18 evidence reuses identical content already assigned to F01');
  });

  it('rejects an acceptance record for a different reviewed source SHA', async () => {
    const fixture = createAcceptanceFixture();

    await expect(verify(fixture, { expectedSourceSha: 'c'.repeat(40) }))
      .rejects.toThrow('source SHA does not match');
  });

  it('rejects a live App Links response with the wrong release certificate', async () => {
    const fixture = createAcceptanceFixture();

    await expect(verify(fixture, { liveAssetLinksBody: validAssetLinks('00'.repeat(32)) }))
      .rejects.toThrow('live App Links response does not authorize the release certificate');
  });

  it('rejects evidence paths that escape the acceptance bundle', async () => {
    const fixture = createAcceptanceFixture();
    fixture.manifest.gates.F18.evidence[0].path = '../outside.txt';
    writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest));

    await expect(verify(fixture)).rejects.toThrow('evidence path must stay inside the bundle');
  });

  it('wires the acceptance verifier before the release-publish step', () => {
    const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/android-promote.yml'), 'utf8');
    const verifier = workflow.indexOf('verify-android-acceptance.mjs');
    const publish = workflow.indexOf('Publish the exact accepted APK bytes');

    expect(workflow).toContain('acceptance_manifest_sha256:');
    expect(workflow).toContain('acceptance-evidence.zip');
    expect(workflow).toContain('apksigner verify');
    expect(workflow).toContain('$certificateMatches.Count -ne 1');
    expect(workflow).toContain('aapt2 dump badging');
    expect(workflow).toContain('APK package ID does not match candidate');
    expect(workflow).toContain('APK versionCode does not match candidate');
    expect(verifier).toBeGreaterThanOrEqual(0);
    expect(publish).toBeGreaterThan(verifier);
  });
});
