import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const androidTagPattern = /^android-v(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$/;
const firstReactNativeVersion = { major: 0, minor: 2, patch: 0 };

function parseAndroidTag(tagName) {
  const match = androidTagPattern.exec(tagName);
  if (!match?.groups) return null;
  return {
    tagName,
    major: Number(match.groups.major),
    minor: Number(match.groups.minor),
    patch: Number(match.groups.patch),
  };
}

function compareVersions(left, right) {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

export function resolveNextAndroidReleaseVersion(tags, runNumber) {
  if (!Number.isSafeInteger(runNumber) || runNumber < 1) {
    throw new Error('The GitHub Actions run number must be a positive safe integer.');
  }

  const latest = tags.map(parseAndroidTag).filter(Boolean).sort(compareVersions).at(-1) ?? null;
  const next = latest && compareVersions(latest, firstReactNativeVersion) >= 0
    ? { ...latest, patch: latest.patch + 1 }
    : firstReactNativeVersion;

  return {
    versionName: `${next.major}.${next.minor}.${next.patch}`,
    versionCode: 1000 + runNumber,
    previousTagName: latest?.tagName ?? '',
  };
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const tags = execFileSync('git', ['tag', '--list', 'android-v*'], { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);
  const version = resolveNextAndroidReleaseVersion(tags, Number(process.env.RUN_NUMBER));
  const output = [
    `version_name=${version.versionName}`,
    `version_code=${version.versionCode}`,
    `previous_tag=${version.previousTagName}`,
  ].join('\n') + '\n';
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output, 'utf8');
  else process.stdout.write(output);
}
