import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { shouldPublishAndroidRelease } from '../scripts/detect-android-release-change.mjs';

describe('Android release change detector', () => {
  it('writes the app-change output when invoked as a GitHub Actions step', () => {
    const script = resolve(process.cwd(), 'scripts/detect-android-release-change.mjs');
    const result = spawnSync(process.execPath, [script], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, EVENT_NAME: 'workflow_dispatch', GITHUB_OUTPUT: '' },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('app_changed=true\n');
  });

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

  it('skips automatic release when only backend npm scripts change', () => {
    expect(shouldPublishAndroidRelease({
      eventName: 'push',
      changedPaths: ['package.json'],
      packageBefore: JSON.stringify({ scripts: { deploy: 'wrangler deploy' } }),
      packageCurrent: JSON.stringify({ scripts: { deploy: 'wrangler deploy --minify' } }),
      frontendSource,
    })).toBe(false);
  });

  it('publishes when the frontend build script changes', () => {
    expect(shouldPublishAndroidRelease({
      eventName: 'push',
      changedPaths: ['package.json'],
      packageBefore: JSON.stringify({ scripts: { build: 'vite build' } }),
      packageCurrent: JSON.stringify({ scripts: { build: 'vite build --base=/app/' } }),
      frontendSource,
    })).toBe(true);
  });

  it('skips direct Worker-only and workflow-only changes', () => {
    for (const path of ['worker/index.ts', 'wrangler.jsonc', '.github/workflows/android-release.yml', 'README.md']) {
      expect(shouldPublishAndroidRelease({ eventName: 'push', changedPaths: [path] })).toBe(false);
    }
  });

  it('skips an automatic release when the push contains no changed paths', () => {
    expect(shouldPublishAndroidRelease({
      eventName: 'push',
      changedPaths: [],
    })).toBe(false);
  });
});
