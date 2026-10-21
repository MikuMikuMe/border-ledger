import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveNextAndroidReleaseVersion } from '../scripts/resolve-android-release-version.mjs';

describe('Android release version resolver', () => {
  it('writes version outputs when invoked as a GitHub Actions step', () => {
    const script = resolve(process.cwd(), 'scripts/resolve-android-release-version.mjs');
    const tags = spawnSync('git', ['tag', '--list', 'android-v*'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    expect(tags.status).toBe(0);

    const result = spawnSync(process.execPath, [script], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, GITHUB_OUTPUT: '', RUN_NUMBER: '37' },
    });
    const expected = resolveNextAndroidReleaseVersion(tags.stdout.split(/\r?\n/).filter(Boolean), 37);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`version_name=${expected.versionName}`);
    expect(result.stdout).toContain(`version_code=${expected.versionCode}`);
    expect(result.stdout).toContain(`previous_tag=${expected.previousTagName}`);
  });

  it('starts the React Native release line at 0.2.0 after the 0.1.x releases', () => {
    expect(resolveNextAndroidReleaseVersion(['android-v0.1.1', 'android-v0.1.3'], 37)).toEqual({
      versionName: '0.2.0',
      versionCode: 1037,
      previousTagName: 'android-v0.1.3',
    });
  });

  it('increments the latest Android candidate tag and ignores malformed tags', () => {
    expect(resolveNextAndroidReleaseVersion([
      'android-v0.1.3',
      'android-v0.2.0',
      'android-v0.1.99',
      'android-vnext',
    ], 38)).toEqual({
      versionName: '0.2.1',
      versionCode: 1038,
      previousTagName: 'android-v0.2.0',
    });
  });

  it('continues patch releases on the latest Android minor line', () => {
    expect(resolveNextAndroidReleaseVersion(['android-v0.2.3', 'android-v0.3.5'], 39)).toEqual({
      versionName: '0.3.6',
      versionCode: 1039,
      previousTagName: 'android-v0.3.5',
    });
  });
});
