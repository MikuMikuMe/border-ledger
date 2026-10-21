import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const APP_LINKS_URL = 'https://pf.lofuyu.com/.well-known/assetlinks.json';
const PACKAGE_ID = 'com.lofuyu.borderledger';
const APP_LINK_RELATION = 'delegate_permission/common.handle_all_urls';
const CURRENT_SIGNING_CERTIFICATE_SHA256 = '58:27:E8:17:EB:AD:9D:47:8C:A2:C3:C4:70:A3:74:2D:78:3F:C7:D2:BF:BF:FB:8C:C5:82:19:B5:F3:E6:84:17';
const PREVIOUS_SIGNING_CERTIFICATE_SHA256 = '1F:F2:A2:5E:39:13:6E:EF:A7:9D:23:CC:75:31:F7:02:B2:A1:62:28:05:38:41:05:09:CA:2F:F6:5B:47:44:ED';
const MAX_ATTEMPTS = 6;
const RETRY_DELAY_MS = 5_000;

const wait = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

function isBorderLedgerEntry(entry) {
  return entry?.target?.namespace === 'android_app'
    && entry.target.package_name === PACKAGE_ID;
}

function matchingEntries(payload) {
  return Array.isArray(payload) ? payload.filter(isBorderLedgerEntry) : [];
}

function relationIsAuthorized(entry) {
  return Array.isArray(entry?.relation) && entry.relation.includes(APP_LINK_RELATION);
}

function signerPresence(entry) {
  const fingerprints = Array.isArray(entry?.target?.sha256_cert_fingerprints)
    ? entry.target.sha256_cert_fingerprints
    : [];
  return {
    current: fingerprints.includes(CURRENT_SIGNING_CERTIFICATE_SHA256),
    legacy: fingerprints.includes(PREVIOUS_SIGNING_CERTIFICATE_SHA256),
  };
}

function diagnosticSummary(entryCount, relationAuthorized, signers) {
  return `matching entries: ${entryCount}, relation authorized: ${relationAuthorized}, current signer present: ${signers.current}, legacy signer present: ${signers.legacy}`;
}

function appLinksDiagnostic(payload) {
  const entries = matchingEntries(payload);
  const relationAuthorized = relationIsAuthorized(entries[0]);
  const signers = signerPresence(entries[0]);
  const valid = entries.length === 1
    && relationAuthorized
    && signers.current
    && signers.legacy;

  return {
    valid,
    summary: diagnosticSummary(entries.length, relationAuthorized, signers),
  };
}

function validateDeploymentRevision(deploymentRevision) {
  if (typeof deploymentRevision !== 'string' || !/^[a-f0-9]{40}$/i.test(deploymentRevision)) {
    throw new Error('A 40-character deployment revision is required to verify production App Links.');
  }
}

function validateAttempts(attempts) {
  if (!Number.isSafeInteger(attempts) || attempts < 1) {
    throw new Error('App Links verification attempts must be a positive integer.');
  }
}

function validateRetryDelay(retryDelayMs) {
  if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0) {
    throw new Error('App Links verification retry delay must be a non-negative integer.');
  }
}

function validateOptions(deploymentRevision, attempts, retryDelayMs) {
  validateDeploymentRevision(deploymentRevision);
  validateAttempts(attempts);
  validateRetryDelay(retryDelayMs);
}

async function responseDiagnostic(response) {
  if (!response || response.status !== 200) {
    return { valid: false, summary: `HTTP status: ${response?.status ?? 'no response'}` };
  }
  try {
    return appLinksDiagnostic(await response.json());
  } catch {
    return { valid: false, summary: 'response was not valid JSON' };
  }
}

async function requestDiagnostic(fetchImpl, url) {
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: {
        'cache-control': 'no-cache',
        pragma: 'no-cache',
      },
    });
    return responseDiagnostic(response);
  } catch {
    return { valid: false, summary: 'request failed before a response was received' };
  }
}

export async function verifyProductionAppLinks({
  fetchImpl = fetch,
  deploymentRevision = process.env.GITHUB_SHA,
  attempts = MAX_ATTEMPTS,
  retryDelayMs = RETRY_DELAY_MS,
  waitImpl = wait,
} = {}) {
  validateOptions(deploymentRevision, attempts, retryDelayMs);

  const url = new URL(APP_LINKS_URL);
  url.searchParams.set('deploymentRevision', deploymentRevision);
  let lastDiagnostic = 'no response received';

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const diagnostic = await requestDiagnostic(fetchImpl, url);
    if (diagnostic.valid) return { attempts: attempt };
    lastDiagnostic = diagnostic.summary;
    if (attempt < attempts) await waitImpl(retryDelayMs);
  }

  throw new Error(`Production App Links verification failed after ${attempts} attempts (${lastDiagnostic}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await verifyProductionAppLinks();
    console.log(`Production App Links verified after ${result.attempts} attempt(s).`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown verification error';
    console.error(`::error::${message}`);
    process.exitCode = 1;
  }
}
