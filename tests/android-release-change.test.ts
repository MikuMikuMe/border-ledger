import { describe, expect, it } from 'vitest';
import { shouldPublishAndroidRelease } from '../scripts/detect-android-release-change.mjs';

describe('Android release change detector', () => {
  const backendOnlyBefore = JSON.stringify({ dependencies: { jose: '6.2.11' } });
  const backendOnlyCurrent = JSON.stringify({ dependencies: { jose: '6.2.12' } });
  const frontendBefore = JSON.stringify({ dependencies: { react: '18.3.0' } });
  const frontendCurrent = JSON.stringify({ dependencies: { react: '18.3.1' } });
  const frontendSource = "import React from 'react';";
  const reactLockBefore = JSON.stringify({ packages: { '': { dependencies: { react: '18.3.1' } }, 'node_modules/react': { version: '18.3.1' } } });
  const reactLockCurrent = JSON.stringify({ packages: { '': { dependencies: { react: '18.3.1' } }, 'node_modules/react': { version: '18.3.2' } } });
  const joseLockBefore = JSON.stringify({ packages: { 'node_modules/jose': { version: '6.2.11' } } });
  const joseLockCurrent = JSON.stringify({ packages: { 'node_modules/jose': { version: '6.2.12' } } });
  const uiGraphBefore = JSON.stringify({ packages: {
    '': { dependencies: { 'new-ui-kit': '1.0.0' } },
    'node_modules/new-ui-kit': { version: '1.0.0', dependencies: { 'ui-helper': '1.0.0' } },
    'node_modules/ui-helper': { version: '1.0.0' },
  } });
  const uiGraphCurrent = JSON.stringify({ packages: {
    '': { dependencies: { 'new-ui-kit': '1.0.0' } },
    'node_modules/new-ui-kit': { version: '1.0.0', dependencies: { 'ui-helper': '1.0.0' } },
    'node_modules/ui-helper': { version: '1.0.1' },
  } });

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
      packageLockBefore: joseLockBefore,
      packageLockCurrent: joseLockCurrent,
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
      packageLockBefore: joseLockBefore,
      packageLockCurrent: joseLockCurrent,
      frontendSource,
    })).toBe(false);
  });

  it('publishes for a lockfile-only frontend resolution change', () => {
    expect(shouldPublishAndroidRelease({
      eventName: 'push',
      changedPaths: ['package-lock.json'],
      packageBefore: frontendBefore,
      packageCurrent: frontendBefore,
      packageLockBefore: reactLockBefore,
      packageLockCurrent: reactLockCurrent,
      frontendSource,
    })).toBe(true);
  });

  it('recognizes dynamic frontend imports', () => {
    expect(shouldPublishAndroidRelease({
      eventName: 'push',
      changedPaths: ['package.json'],
      packageBefore: JSON.stringify({ dependencies: {} }),
      packageCurrent: JSON.stringify({ dependencies: { 'new-ui-kit': '1.0.0' } }),
      frontendSource: "const ui = import('new-ui-kit');",
    })).toBe(true);
  });

  it('recognizes bare side-effect frontend imports', () => {
    expect(shouldPublishAndroidRelease({
      eventName: 'push',
      changedPaths: ['package.json'],
      packageBefore: JSON.stringify({ dependencies: {} }),
      packageCurrent: JSON.stringify({ dependencies: { 'new-ui-kit': '1.0.0' } }),
      frontendSource: "import 'new-ui-kit';",
    })).toBe(true);
  });

  it('follows the lockfile graph for a changed transitive frontend package', () => {
    expect(shouldPublishAndroidRelease({
      eventName: 'push',
      changedPaths: ['package-lock.json'],
      packageBefore: JSON.stringify({ dependencies: { 'new-ui-kit': '1.0.0' } }),
      packageCurrent: JSON.stringify({ dependencies: { 'new-ui-kit': '1.0.0' } }),
      packageLockBefore: uiGraphBefore,
      packageLockCurrent: uiGraphCurrent,
      frontendSource: "import { Button } from 'new-ui-kit';",
    })).toBe(true);
  });

  it('follows optional and peer frontend dependency edges', () => {
    const before = JSON.stringify({ packages: {
      '': { dependencies: { 'new-ui-kit': '1.0.0' } },
      'node_modules/new-ui-kit': { version: '1.0.0', optionalDependencies: { 'ui-helper': '1.0.0' }, peerDependencies: { 'ui-peer': '1.0.0' } },
      'node_modules/ui-helper': { version: '1.0.0' },
      'node_modules/ui-peer': { version: '1.0.0' },
    } });
    const current = JSON.stringify({ packages: {
      '': { dependencies: { 'new-ui-kit': '1.0.0' } },
      'node_modules/new-ui-kit': { version: '1.0.0', optionalDependencies: { 'ui-helper': '1.0.0' }, peerDependencies: { 'ui-peer': '1.0.0' } },
      'node_modules/ui-helper': { version: '1.0.1' },
      'node_modules/ui-peer': { version: '1.0.1' },
    } });
    expect(shouldPublishAndroidRelease({
      eventName: 'push',
      changedPaths: ['package-lock.json'],
      packageBefore: JSON.stringify({ dependencies: { 'new-ui-kit': '1.0.0' } }),
      packageCurrent: JSON.stringify({ dependencies: { 'new-ui-kit': '1.0.0' } }),
      packageLockBefore: before,
      packageLockCurrent: current,
      frontendSource: "import { Button } from 'new-ui-kit';",
    })).toBe(true);
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
