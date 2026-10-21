import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep, win32 } from 'node:path';
import { pathToFileURL } from 'node:url';

const PACKAGE_ID = 'com.lofuyu.borderledger';
const APP_LINKS_URL = 'https://pf.lofuyu.com/.well-known/assetlinks.json';
const APP_LINK_RELATION = 'delegate_permission/common.handle_all_urls';
const PREVIOUS_SIGNING_CERTIFICATE_SHA256 = '1ff2a25e39136eefa79d23cc7531f702b2a162280538410509ca2ff65b4744ed';
const GATE_IDS = Array.from({ length: 18 }, (_, index) => `F${String(index + 1).padStart(2, '0')}`);
const MAX_ACCEPTANCE_EVIDENCE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function fail(message) {
  throw new Error(message);
}

function requireString(value, description) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${description} must be a non-empty string`);
  return value.trim();
}

function normalizeSha256(value, description) {
  const normalized = requireString(value, description).replaceAll(':', '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) fail(`${description} must be a SHA-256 digest`);
  return normalized;
}

function normalizeSourceSha(value, description) {
  const normalized = requireString(value, description).toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(normalized)) fail(`${description} must be a full commit SHA`);
  return normalized;
}

function equal(value, expected, message) {
  if (value !== expected) fail(message);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readJson(path, description) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    fail(`${description} could not be read`);
  }
  try {
    return JSON.parse(text);
  } catch {
    fail(`${description} is not valid JSON`);
  }
}

function hasUnsafeEvidencePath(relativePath) {
  const unsafeAbsolute = isAbsolute(relativePath) || win32.isAbsolute(relativePath) || relativePath.includes('\\');
  const hasUnsafeSegment = relativePath.split('/').some((segment) => ['', '.', '..'].includes(segment));
  return unsafeAbsolute || hasUnsafeSegment;
}

function isOutsideEvidenceRoot(evidenceRoot, filePath) {
  const pathFromRoot = relative(evidenceRoot, filePath);
  return pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot);
}

function resolveEvidencePath(referencePath, evidenceRoot) {
  const relativePath = requireString(referencePath, 'evidence path');
  if (hasUnsafeEvidencePath(relativePath)) fail('evidence path must stay inside the bundle');

  const fullPath = resolve(evidenceRoot, ...relativePath.split('/'));
  if (isOutsideEvidenceRoot(evidenceRoot, fullPath) || fullPath === evidenceRoot) {
    fail('evidence path must stay inside the bundle');
  }
  return fullPath;
}

function assertRegularFile(fileInfo, description) {
  if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) fail(`${description} must be a regular file`);
}

function assertInsideEvidenceRoot(evidenceRoot, filePath) {
  if (isOutsideEvidenceRoot(evidenceRoot, filePath) || filePath === evidenceRoot) {
    fail('evidence path must stay inside the bundle');
  }
}

async function readEvidenceBytes(fullPath, evidenceRoot, description) {
  try {
    const fileInfo = await lstat(fullPath);
    assertRegularFile(fileInfo, description);
    const actualPath = await realpath(fullPath);
    assertInsideEvidenceRoot(evidenceRoot, actualPath);
    return await readFile(actualPath);
  } catch (error) {
    if (isExpectedEvidenceValidationError(error)) throw error;
    fail(`${description} could not be read`);
  }
}

function isExpectedEvidenceValidationError(error) {
  if (!(error instanceof Error)) return false;
  const isKnownValidationError = error.message.includes('must be a regular file')
    || error.message.includes('must stay inside the bundle');
  return isKnownValidationError;
}

async function readVerifiedEvidence(reference, evidenceRoot, description) {
  if (!isRecord(reference)) {
    fail(`${description} must include a path and SHA-256 digest`);
  }

  const fullPath = resolveEvidencePath(reference.path, evidenceRoot);
  const bytes = await readEvidenceBytes(fullPath, evidenceRoot, description);
  if (bytes.byteLength === 0) fail(`${description} must not be empty`);

  const expectedDigest = normalizeSha256(reference.sha256, `${description} SHA-256`);
  if (sha256(bytes) !== expectedDigest) fail(`${description} evidence checksum mismatch`);
  return bytes;
}

function hasSigningCertificate(fingerprints, expectedCertificate) {
  if (!Array.isArray(fingerprints)) return false;
  return fingerprints.some((fingerprint) => {
    try {
      return normalizeSha256(fingerprint, 'App Links certificate') === expectedCertificate;
    } catch {
      return false;
    }
  });
}

function isAuthorizedAppLinkEntry(entry, expectedCertificate) {
  if (!isRecord(entry)) return false;
  const target = entry.target;
  if (!isRecord(target)) return false;
  const hasRelation = Array.isArray(entry.relation) && entry.relation.includes(APP_LINK_RELATION);
  const hasExpectedTarget = target.namespace === 'android_app' && target.package_name === PACKAGE_ID;
  return hasRelation && hasExpectedTarget && hasSigningCertificate(target.sha256_cert_fingerprints, expectedCertificate);
}

function appLinksAuthorizes(payload, signingCertificateSha256) {
  return Array.isArray(payload)
    && payload.some((entry) => (
      isAuthorizedAppLinkEntry(entry, signingCertificateSha256)
      && isAuthorizedAppLinkEntry(entry, PREVIOUS_SIGNING_CERTIFICATE_SHA256)
    ));
}

async function verifyLiveAppLinks({ fetchImpl, expectedDigest, signingCertificateSha256 }) {
  let response;
  try {
    response = await fetchImpl(APP_LINKS_URL, { method: 'GET', redirect: 'error' });
  } catch {
    fail('live App Links endpoint could not be fetched');
  }

  if (!response || response.status !== 200) fail('live App Links endpoint must return HTTP 200');
  const contentType = response.headers?.get?.('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) fail('live App Links endpoint must return JSON');
  let body;
  let payload;
  try {
    body = await response.text();
    payload = JSON.parse(body);
  } catch {
    fail('live App Links response is not valid JSON');
  }
  if (!appLinksAuthorizes(payload, signingCertificateSha256)) {
    fail('live App Links response does not authorize both production signers');
  }
  if (sha256(Buffer.from(body, 'utf8')) !== expectedDigest) {
    fail('live App Links response does not match the checksummed acceptance evidence');
  }
}

function verifyManifestIdentity(manifest, options) {
  equal(manifest.schemaVersion, 2, 'Acceptance manifest schemaVersion must be 2');
  const sourceSha = normalizeSourceSha(manifest.sourceSha, 'Manifest source SHA');
  equal(sourceSha, normalizeSourceSha(options.expectedSourceSha, 'Expected source SHA'), 'source SHA does not match');

  const apkSha256 = normalizeSha256(manifest.apkSha256, 'Manifest APK SHA-256');
  equal(apkSha256, normalizeSha256(options.expectedApkSha256, 'Expected APK SHA-256'), 'APK SHA-256 does not match');
  equal(manifest.packageId, PACKAGE_ID, 'Acceptance package ID must be the production package');
  equal(manifest.mobileEnvironment, 'production', 'Acceptance environment must be production');

  const signingCertificateSha256 = normalizeSha256(manifest.signingCertificateSha256, 'Manifest signing certificate SHA-256');
  equal(
    signingCertificateSha256,
    normalizeSha256(options.expectedSigningCertificateSha256, 'Expected signing certificate SHA-256'),
    'Signing certificate does not match the production identity',
  );

  const versionCode = Number(manifest.versionCode);
  if (!Number.isSafeInteger(versionCode) || versionCode < 1) fail('Manifest versionCode must be a positive integer');
  if (Number(options.expectedVersionCode) !== versionCode) fail('Manifest versionCode does not match the candidate');
  return { signingCertificateSha256, sourceSha, versionCode };
}

function verifyEvidenceAttestation(reference, gateId, sourceSha, description) {
  if (!isRecord(reference)) fail(`${description} must include a source-bound attestation`);
  if (!isRecord(reference.attestation)) fail(`${description} must include a source-bound attestation`);
  const attestation = reference.attestation;
  const attestedSourceSha = normalizeSourceSha(attestation.sourceSha, `${description} attestation source SHA`);
  equal(attestedSourceSha, sourceSha, `${description} attestation source SHA does not match`);
  equal(requireString(attestation.gateId, `${description} attestation gate ID`), gateId, `${description} attestation gate ID does not match`);

  const capturedAt = requireString(attestation.capturedAt, `${description} attestation capture time`);
  if (!isValidCaptureTime(capturedAt)) fail(`${description} attestation capture time must be a valid UTC ISO-8601 timestamp`);
  if (isFutureCaptureTime(capturedAt)) fail(`${description} attestation capture time cannot be in the future`);
  if (isStaleCaptureTime(capturedAt)) fail(`${description} attestation capture time is older than 30 days`);

  requireString(attestation.device, `${description} attestation device`);
  const evidenceType = requireString(attestation.evidenceType, `${description} attestation evidence type`);
  verifyEvidenceType(evidenceType, description);
}

function isValidCaptureTime(capturedAt) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(capturedAt)) return false;
  const captureTime = new Date(capturedAt);
  if (Number.isNaN(captureTime.getTime())) return false;
  if (captureTime.toISOString().slice(0, 19) !== capturedAt.slice(0, 19)) return false;
  return true;
}

function isFutureCaptureTime(capturedAt) {
  return new Date(capturedAt).getTime() > Date.now() + 300_000;
}

function isStaleCaptureTime(capturedAt) {
  return Date.now() - new Date(capturedAt).getTime() > MAX_ACCEPTANCE_EVIDENCE_AGE_MS;
}

function verifyEvidenceType(evidenceType, description) {
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(evidenceType)) {
    fail(`${description} attestation evidence type must be a lowercase slug`);
  }
}

function gateEvidenceItems(gate) {
  if (!isRecord(gate)) return null;
  return Array.isArray(gate.evidence) ? gate.evidence : null;
}

function claimUniqueEvidenceValue(registry, value, gateId, description) {
  const previousOwner = registry.get(value);
  if (previousOwner) fail(`${gateId} evidence ${description} already assigned to ${previousOwner}`);
  registry.set(value, gateId);
}

function registerEvidenceClaim({ gateId, index, evidence, evidenceRoot, pathOwners, digestOwners }) {
  if (!isRecord(evidence)) return;
  const evidencePath = resolveEvidencePath(evidence.path, evidenceRoot);
  claimUniqueEvidenceValue(pathOwners, evidencePath, gateId, 'reuses a file');

  const description = `${gateId} evidence ${index + 1} SHA-256`;
  const digest = normalizeSha256(evidence.sha256, description);
  claimUniqueEvidenceValue(digestOwners, digest, gateId, 'reuses identical content');
}

function verifyUniqueEvidenceFiles(gates, evidenceRoot) {
  const pathOwners = new Map();
  const digestOwners = new Map();
  for (const gateId of GATE_IDS) {
    const evidenceItems = gateEvidenceItems(gates[gateId]);
    if (evidenceItems === null) continue;
    evidenceItems.forEach((evidence, index) => registerEvidenceClaim({
      gateId,
      index,
      evidence,
      evidenceRoot,
      pathOwners,
      digestOwners,
    }));
  }
}

async function verifyGateEvidence(gateId, gate, evidenceRoot, sourceSha) {
  if (!isRecord(gate) || gate.status !== 'passed') fail(`${gateId} must be passed`);
  if (!Array.isArray(gate.evidence) || gate.evidence.length === 0) fail(`${gateId} must include checksummed evidence`);
  const evidenceChecks = gate.evidence.map((evidence, index) => {
    const description = `${gateId} evidence ${index + 1}`;
    verifyEvidenceAttestation(evidence, gateId, sourceSha, description);
    return readVerifiedEvidence(evidence, evidenceRoot, description);
  });
  await Promise.all(evidenceChecks);
}

function verifyGateSetShape(gates) {
  if (!isRecord(gates)) fail('Acceptance manifest must include F01–F18 gates');
  const unexpectedGates = Object.keys(gates).filter((gateId) => !GATE_IDS.includes(gateId));
  if (unexpectedGates.length > 0) fail(`Unexpected acceptance gates: ${unexpectedGates.join(', ')}`);
}

async function verifyFeatureGates(gates, evidenceRoot, sourceSha) {
  verifyGateSetShape(gates);
  verifyUniqueEvidenceFiles(gates, evidenceRoot);
  await Promise.all(GATE_IDS.map((gateId) => verifyGateEvidence(gateId, gates[gateId], evidenceRoot, sourceSha)));
}

async function verifyAppLinksAcceptance(appLinks, evidenceRoot, signingCertificateSha256, fetchImpl) {
  if (!appLinks || appLinks.status !== 'passed') fail('App Links acceptance must be passed');
  equal(appLinks.url, APP_LINKS_URL, 'App Links acceptance URL must be the production endpoint');
  equal(appLinks.packageId, PACKAGE_ID, 'App Links package ID must match the production package');
  equal(
    normalizeSha256(appLinks.signingCertificateSha256, 'App Links signing certificate SHA-256'),
    signingCertificateSha256,
    'App Links acceptance certificate does not match the production identity',
  );
  const appLinksEvidence = await readVerifiedEvidence(appLinks.responseEvidence, evidenceRoot, 'App Links response');
  const appLinksDigest = sha256(appLinksEvidence);
  equal(
    appLinksDigest,
    normalizeSha256(appLinks.responseSha256, 'App Links response SHA-256'),
    'App Links response digest does not match its evidence file',
  );
  await verifyLiveAppLinks({ fetchImpl, expectedDigest: appLinksDigest, signingCertificateSha256 });
}

function verifyInPlaceUpgradeMetadata(installation, versionCode) {
  const fromVersionCode = Number(installation.fromVersionCode);
  const toVersionCode = Number(installation.toVersionCode);
  if (!Number.isSafeInteger(fromVersionCode)) fail('In-place upgrade source versionCode must be an integer');
  if (fromVersionCode < 1) fail('In-place upgrade must start from a positive versionCode');
  if (fromVersionCode >= versionCode) fail('In-place upgrade must start from a lower versionCode');
  if (toVersionCode !== versionCode) fail('In-place upgrade target versionCode does not match the candidate');
  return { mode: 'in-place-upgrade', fromVersionCode, toVersionCode };
}

function verifyFreshInstallDataDisposition(value) {
  const dataDisposition = requireString(value, 'Fresh-install dataDisposition');
  if (!['backup-verified', 'no-existing-data'].includes(dataDisposition)) {
    fail('Fresh-install dataDisposition must be "backup-verified" or "no-existing-data"');
  }
  return dataDisposition;
}

function verifyFreshInstallMetadata(installation, signingCertificateSha256, versionCode) {
  const previousSigningCertificateSha256 = normalizeSha256(
    installation.previousSigningCertificateSha256,
    'Previous signing certificate SHA-256',
  );
  if (previousSigningCertificateSha256 === signingCertificateSha256) {
    fail('Fresh-install acceptance requires a different previous signing certificate');
  }
  if (previousSigningCertificateSha256 !== PREVIOUS_SIGNING_CERTIFICATE_SHA256) {
    fail('Fresh-install acceptance previous signing certificate does not match the known previous production signer');
  }
  if (Number(installation.versionCode) !== versionCode) fail('Fresh-install target versionCode does not match the candidate');
  return {
    mode: 'fresh-install',
    previousSigningCertificateSha256,
    versionCode,
    dataDisposition: verifyFreshInstallDataDisposition(installation.dataDisposition),
  };
}

function verifyInstallationMetadata(installation, signingCertificateSha256, versionCode) {
  if (!isRecord(installation) || installation.status !== 'passed') fail('Android installation acceptance must be passed');
  equal(installation.packageId, PACKAGE_ID, 'Installation acceptance package ID must match the production package');
  equal(
    normalizeSha256(installation.signingCertificateSha256, 'Installation acceptance signing certificate SHA-256'),
    signingCertificateSha256,
    'Installation acceptance certificate does not match the production identity',
  );

  const mode = requireString(installation.mode, 'Installation acceptance mode');
  if (mode === 'in-place-upgrade') return verifyInPlaceUpgradeMetadata(installation, versionCode);
  if (mode === 'fresh-install') return verifyFreshInstallMetadata(installation, signingCertificateSha256, versionCode);
  fail('Installation acceptance mode must be "in-place-upgrade" or "fresh-install"');
}

async function verifyInstallationEvidence(installation, evidenceRoot, signingCertificateSha256, metadata) {
  const evidenceBytes = await readVerifiedEvidence(installation.evidence, evidenceRoot, 'Android installation');
  let evidence;
  try {
    evidence = JSON.parse(evidenceBytes.toString('utf8'));
  } catch {
    fail('Android installation evidence must be valid JSON');
  }
  equal(evidence.packageId, PACKAGE_ID, 'Android installation evidence package ID does not match');
  equal(
    normalizeSha256(evidence.signingCertificateSha256, 'Android installation evidence signing certificate SHA-256'),
    signingCertificateSha256,
    'Android installation evidence has the wrong signing certificate',
  );

  if (metadata.mode === 'in-place-upgrade') {
    if (Number(evidence.fromVersionCode) !== metadata.fromVersionCode
      || Number(evidence.toVersionCode) !== metadata.toVersionCode) {
      fail('In-place upgrade evidence versions do not match the acceptance manifest');
    }
    if (evidence.upgradedExistingInstallation !== true || evidence.existingAppDataPreserved !== true) {
      fail('In-place upgrade evidence must confirm upgrade and existing app-data preservation');
    }
    return;
  }

  equal(
    normalizeSha256(evidence.previousSigningCertificateSha256, 'Evidence previous signing certificate SHA-256'),
    metadata.previousSigningCertificateSha256,
    'Fresh-install evidence previous certificate does not match the acceptance manifest',
  );
  if (Number(evidence.versionCode) !== metadata.versionCode) fail('Fresh-install evidence versionCode does not match the candidate');
  if (evidence.freshInstallCompleted !== true || evidence.previousAppAbsent !== true) {
    fail('Fresh-install evidence must confirm installation completed with the previous app absent');
  }
  equal(evidence.dataDisposition, metadata.dataDisposition, 'Fresh-install evidence data disposition does not match the acceptance manifest');
}

/**
 * Verify a human-captured Android acceptance bundle before a signed candidate
 * is made public. This deliberately fails closed on missing or stale evidence.
 */
export async function verifyAndroidAcceptance({
  manifestPath,
  evidenceDirectory,
  expectedSourceSha,
  expectedApkSha256,
  expectedSigningCertificateSha256,
  expectedVersionCode,
  fetchImpl = globalThis.fetch,
}) {
  const manifestFile = resolve(requireString(manifestPath, 'manifestPath'));
  const evidenceRoot = await realpath(requireString(evidenceDirectory, 'evidenceDirectory'));
  const manifest = await readJson(manifestFile, 'Acceptance manifest');
  if (!isRecord(manifest)) fail('Acceptance manifest must be an object');
  const { signingCertificateSha256, sourceSha, versionCode } = verifyManifestIdentity(manifest, {
    expectedSourceSha,
    expectedApkSha256,
    expectedSigningCertificateSha256,
    expectedVersionCode,
  });
  await verifyFeatureGates(manifest.gates, evidenceRoot, sourceSha);
  await verifyAppLinksAcceptance(manifest.appLinks, evidenceRoot, signingCertificateSha256, fetchImpl);
  const installation = manifest.installationAcceptance;
  const installationMetadata = verifyInstallationMetadata(installation, signingCertificateSha256, versionCode);
  await verifyInstallationEvidence(installation, evidenceRoot, signingCertificateSha256, installationMetadata);

  return { verified: true, featureGateCount: GATE_IDS.length, installationMode: installationMetadata.mode };
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!isValueOption(argv, index, key)) fail(`Invalid command-line argument: ${key}`);
    values.set(key.slice(2), argv[index + 1]);
    index += 1;
  }
  return values;
}

function isValueOption(argv, index, key) {
  const hasOptionName = key.startsWith('--');
  const hasValue = index + 1 < argv.length;
  const valueIsOption = hasValue && argv[index + 1].startsWith('--');
  return hasOptionName && hasValue && !valueIsOption;
}

async function runCli() {
  const args = parseArguments(process.argv.slice(2));
  const required = ['manifest', 'evidence-dir', 'source-sha', 'apk-sha256', 'signing-cert-sha256', 'version-code'];
  for (const key of required) if (!args.has(key)) fail(`Missing required option --${key}`);
  const result = await verifyAndroidAcceptance({
    manifestPath: args.get('manifest'),
    evidenceDirectory: args.get('evidence-dir'),
    expectedSourceSha: args.get('source-sha'),
    expectedApkSha256: args.get('apk-sha256'),
    expectedSigningCertificateSha256: args.get('signing-cert-sha256'),
    expectedVersionCode: Number(args.get('version-code')),
  });
  const installationDescription = result.installationMode === 'fresh-install' ? 'fresh install' : 'signed in-place upgrade';
  process.stdout.write(`Android acceptance verified: ${result.featureGateCount} feature gates, App Links, and ${installationDescription}.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli().catch((error) => {
    process.stderr.write(`Android acceptance verification failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
  });
}
