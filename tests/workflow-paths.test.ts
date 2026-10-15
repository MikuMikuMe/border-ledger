import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP_WORKFLOW = resolve(process.cwd(), '.github/workflows/app-build.yml');

const APP_PATH_ALLOWLIST = [
  'android/**',
  'src/**',
  'index.html',
  'contracts/**',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vite.config.ts',
  'public/**',
  '.github/workflows/app-build.yml',
];

type WorkflowTrigger = 'push' | 'pull_request';

function triggerPaths(source: string, trigger: WorkflowTrigger): string[] {
  const lines = source.split(/\r?\n/);
  const triggerIndex = lines.findIndex((line) => new RegExp(`^  ${trigger}:\\s*$`).test(line));
  if (triggerIndex < 0) return [];

  const pathsIndex = lines.findIndex((line, index) => {
    if (index <= triggerIndex) return false;
    if (line.trim() && (line.match(/^\s*/) ?? [''])[0].length <= 2) return false;
    return /^    paths:\s*$/.test(line);
  });
  if (pathsIndex < 0) return [];

  const paths: string[] = [];
  for (const line of lines.slice(pathsIndex + 1)) {
    if (line.trim() && (line.match(/^\s*/) ?? [''])[0].length <= 4) break;
    const item = line.match(/^\s{6}-\s*(.+?)\s*$/);
    if (item) paths.push(item[1].replace(/^['"]|['"]$/g, ''));
  }
  return paths;
}

function matchesPath(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => pattern.endsWith('/**')
    ? path.startsWith(pattern.slice(0, -2))
    : path === pattern);
}

function readAppWorkflow(): string {
  return readFileSync(APP_WORKFLOW, 'utf8');
}

describe('app-build workflow path contract', () => {
  it('matches every app-owned path and excludes representative backend-only changes', () => {
    const source = readAppWorkflow();

    expect(source).toMatch(/^  workflow_dispatch:\s*$/m);
    for (const trigger of ['push', 'pull_request'] as const) {
      expect(triggerPaths(source, trigger)).toEqual(APP_PATH_ALLOWLIST);
    }

    const appChanges = [
      'android/app/src/main/AndroidManifest.xml',
      'src/App.tsx',
      'index.html',
      'contracts/mobile-v1.openapi.yaml',
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'vite.config.ts',
      'public/brand.svg',
      '.github/workflows/app-build.yml',
    ];
    const backendOnlyChanges = [
      'worker/index.ts',
      'worker/migrations/0018-fx-snapshots.sql',
      'wrangler.jsonc',
      'tests/worker-route.test.ts',
      'tests/ledger-reports-fx.test.ts',
    ];

    expect(appChanges.every((path) => matchesPath(path, APP_PATH_ALLOWLIST))).toBe(true);
    expect(backendOnlyChanges.some((path) => matchesPath(path, APP_PATH_ALLOWLIST))).toBe(false);
  });

  it('keeps the app workflow least-privileged and free of signing claims', () => {
    const source = readAppWorkflow();

    expect(source).toMatch(/^permissions:\r?\n  contents: read\s*$/m);
    expect(source).not.toMatch(/contents:\s*write|id-token:\s*write|write-all/);
    expect(source).toContain('npm run typecheck');
    expect(source).toContain('npm run build');
    expect(source).toContain('lintDebug');
    expect(source).toContain('testDebugUnitTest');
    expect(source).not.toContain('assembleRelease');
    expect(source).not.toMatch(/secrets\./);
  });
});
