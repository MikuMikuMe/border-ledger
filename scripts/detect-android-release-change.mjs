import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BACKEND_ONLY_PATH = /^(?:worker\/|wrangler\.jsonc$|\.github\/workflows\/deploy\.yml$|tests\/(?:worker-|ledger-|fx-))/;
const FRONTEND_BUILD_DEPENDENCIES = new Set(['@types/react', '@types/react-dom', '@vitejs/plugin-react', 'vite', 'typescript']);

function readFrontendSource(root) {
  const files = ['index.html', 'vite.config.ts'];
  const visit = (directory) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (/\.(?:css|html|js|jsx|ts|tsx)$/.test(entry.name)) files.push(path);
    }
  };
  visit(join(root, 'src'));
  return files.filter((path) => existsSync(join(root, path)) || existsSync(path))
    .map((path) => readFileSync(existsSync(path) ? path : join(root, path), 'utf8'))
    .join('\n');
}

function dependencyIsFrontend(name, frontendSource) {
  if (FRONTEND_BUILD_DEPENDENCIES.has(name)) return true;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:from\\s+|import\\s*\\(|require\\s*\\()\\s*["']${escaped}(?:/|["'])`).test(frontendSource);
}

function parsePackageJson(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
}

function lockfileAffectsFrontend(beforeValue, currentValue, frontendSource) {
  const before = parsePackageJson(beforeValue);
  const current = parsePackageJson(currentValue);
  const beforePackages = before.packages ?? {};
  const currentPackages = current.packages ?? {};
  const packagePaths = new Set([...Object.keys(beforePackages), ...Object.keys(currentPackages)]);
  return [...packagePaths].some((path) => {
    if (!path.startsWith('node_modules/')) return false;
    const beforePackage = beforePackages[path] ?? null;
    const currentPackage = currentPackages[path] ?? null;
    if (JSON.stringify(beforePackage) === JSON.stringify(currentPackage)) return false;
    const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    return dependencyIsFrontend(name, frontendSource);
  });
}

function packageAffectsFrontend(beforeValue, currentValue, lockBeforeValue, lockCurrentValue, frontendSource) {
  const before = parsePackageJson(beforeValue);
  const current = parsePackageJson(currentValue);
  if (JSON.stringify(before.scripts ?? {}) !== JSON.stringify(current.scripts ?? {})) return true;

  const beforeDependencies = { ...(before.dependencies ?? {}), ...(before.devDependencies ?? {}) };
  const currentDependencies = { ...(current.dependencies ?? {}), ...(current.devDependencies ?? {}) };
  const names = new Set([...Object.keys(beforeDependencies), ...Object.keys(currentDependencies)]);
  return [...names].some((name) => beforeDependencies[name] !== currentDependencies[name] && dependencyIsFrontend(name, frontendSource))
    || lockfileAffectsFrontend(lockBeforeValue, lockCurrentValue, frontendSource);
}

export function shouldPublishAndroidRelease({ eventName, changedPaths, packageDiff = '', packageBefore = '', packageCurrent = '', packageLockBefore = '', packageLockCurrent = '', frontendSource = readFrontendSource(process.cwd()) }) {
  if (eventName === 'workflow_dispatch') return true;
  if (changedPaths.length === 0) return true;

  const packageChanged = changedPaths.some((path) => path === 'package.json' || path === 'package-lock.json');
  if (!packageChanged) return true;

  const nonPackagePaths = changedPaths.filter((path) => path !== 'package.json' && path !== 'package-lock.json');
  const frontendPackageChanged = packageAffectsFrontend(packageBefore, packageCurrent, packageLockBefore, packageLockCurrent, frontendSource);
  if (frontendPackageChanged) return true;
  if (nonPackagePaths.length === 0) return false;

  return !nonPackagePaths.every((path) => BACKEND_ONLY_PATH.test(path));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const changedPaths = (process.env.CHANGED_PATHS ?? '').split(/\r?\n/).filter(Boolean);
  const appChanged = shouldPublishAndroidRelease({
    eventName: process.env.EVENT_NAME ?? '',
    changedPaths,
    packageDiff: process.env.PACKAGE_DIFF ?? '',
    packageBefore: process.env.PACKAGE_BEFORE ?? '',
    packageCurrent: process.env.PACKAGE_CURRENT ?? '',
    packageLockBefore: process.env.PACKAGE_LOCK_BEFORE ?? '',
    packageLockCurrent: process.env.PACKAGE_LOCK_CURRENT ?? '',
  });
  process.stdout.write(`app_changed=${appChanged}\n`);
}
