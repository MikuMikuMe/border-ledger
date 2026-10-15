import { describe, expect, it } from 'vitest';
import { shouldPublishAndroidRelease } from '../scripts/detect-android-release-change.mjs';

describe('Android release change detector', () => {
  it('publishes for a frontend dependency-only manifest change', () => {
    expect(shouldPublishAndroidRelease({
      eventName: 'push',
      changedPaths: ['package.json', 'package-lock.json'],
      packageDiff: '+  "react": "18.3.1",',
    })).toBe(true);
  });

  it('skips a backend dependency-only manifest change', () => {
    expect(shouldPublishAndroidRelease({
      eventName: 'push',
      changedPaths: ['package.json', 'package-lock.json'],
      packageDiff: '+  "jose": "6.2.12",',
    })).toBe(false);
  });

  it('skips package changes bundled only with Worker paths', () => {
    expect(shouldPublishAndroidRelease({
      eventName: 'push',
      changedPaths: ['package.json', 'worker/index.ts', 'wrangler.jsonc'],
      packageDiff: '+  "jose": "6.2.12",',
    })).toBe(false);
  });

  it('publishes when a backend package change also changes app source', () => {
    expect(shouldPublishAndroidRelease({
      eventName: 'push',
      changedPaths: ['package.json', 'worker/index.ts', 'src/App.tsx'],
      packageDiff: '+  "jose": "6.2.12",',
    })).toBe(true);
  });

  it('keeps manual main-branch recovery releases available', () => {
    expect(shouldPublishAndroidRelease({
      eventName: 'workflow_dispatch',
      changedPaths: ['worker/index.ts'],
    })).toBe(true);
  });
});
