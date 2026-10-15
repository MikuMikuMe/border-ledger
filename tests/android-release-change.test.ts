import { describe, expect, it } from 'vitest';
import { shouldPublishAndroidRelease } from '../scripts/detect-android-release-change.mjs';

describe('Android release change detector', () => {
  const backendOnlyBefore = JSON.stringify({ dependencies: { jose: '6.2.11' } });
  const backendOnlyCurrent = JSON.stringify({ dependencies: { jose: '6.2.12' } });
  const frontendBefore = JSON.stringify({ dependencies: { react: '18.3.0' } });
  const frontendCurrent = JSON.stringify({ dependencies: { react: '18.3.1' } });
  const frontendSource = "import React from 'react';";

  it('publishes for a frontend dependency-only manifest change', () => {
    expect(shouldPublishAndroidRelease({
      eventName: 'push',
      changedPaths: ['package.json', 'package-lock.json'],
      packageBefore: frontendBefore,
      packageCurrent: frontendCurrent,
      frontendSource,
    })).toBe(true);
  });

  it('skips a backend dependency-only manifest change', () => {
    expect(shouldPublishAndroidRelease({
      eventName: 'push',
      changedPaths: ['package.json', 'package-lock.json'],
      packageBefore: backendOnlyBefore,
      packageCurrent: backendOnlyCurrent,
      frontendSource,
    })).toBe(false);
  });

  it('skips package changes bundled only with Worker paths', () => {
    expect(shouldPublishAndroidRelease({
      eventName: 'push',
      changedPaths: ['package.json', 'worker/index.ts', 'wrangler.jsonc'],
      packageBefore: backendOnlyBefore,
      packageCurrent: backendOnlyCurrent,
      frontendSource,
    })).toBe(false);
  });

  it('detects an unlisted UI dependency from the actual frontend import graph', () => {
    expect(shouldPublishAndroidRelease({
      eventName: 'push',
      changedPaths: ['package.json'],
      packageBefore: JSON.stringify({ dependencies: {} }),
      packageCurrent: JSON.stringify({ dependencies: { 'new-ui-kit': '1.0.0' } }),
      frontendSource: "import { Button } from 'new-ui-kit';",
    })).toBe(true);
  });

  it('does not treat a lockfile-only backend version line as frontend work', () => {
    expect(shouldPublishAndroidRelease({
      eventName: 'push',
      changedPaths: ['package-lock.json'],
      packageBefore: backendOnlyBefore,
      packageCurrent: backendOnlyBefore,
      packageDiff: '+  "version": "6.2.12",',
      frontendSource,
    })).toBe(false);
  });

  it('publishes when a backend package change also changes app source', () => {
    expect(shouldPublishAndroidRelease({
      eventName: 'push',
      changedPaths: ['package.json', 'worker/index.ts', 'src/App.tsx'],
      packageBefore: backendOnlyBefore,
      packageCurrent: backendOnlyCurrent,
      frontendSource,
    })).toBe(true);
  });

  it('keeps manual main-branch recovery releases available', () => {
    expect(shouldPublishAndroidRelease({
      eventName: 'workflow_dispatch',
      changedPaths: ['worker/index.ts'],
    })).toBe(true);
  });
});
