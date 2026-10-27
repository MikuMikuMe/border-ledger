import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_SOURCE_PATH = /^(?:android\/|mobile\/|shared\/|src\/|contracts\/|index\.html$|tsconfig\.json$|vite\.config\.ts$|vitest\.config\.ts$|public\/)/;
const FRONTEND_BUILD_SCRIPTS = new Set(['build']);
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
  return new RegExp(`(?:from\\s+|import\\s*(?:\\(\\s*)?|require\\s*\\()\\s*["']${escaped}(?:/|["'])`).test(frontendSource);
}

function parsePackageJson(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
}

function readGitFile(commitSha, path) {
  try {
    return execFileSync('git', ['show', `${commitSha}:${path}`], { encoding: 'utf8' });
  } catch (error) {
    if (error?.status === 128) return '';
    throw error;
  }
}

function resolvePackagePath(parentPath, dependencyName, packages) {
  let base = parentPath;
  while (true) {
    const candidate = base ? `${base}/node_modules/${dependencyName}` : `node_modules/${dependencyName}`;
    if (packages[candidate]) return candidate;
    if (!base) return null;
    const nested = base.lastIndexOf('/node_modules/');
    base = nested < 0 ? '' : base.slice(0, nested);
  }
}

function dependencyClosure(lockfile, rootNames) {
  const packages = lockfile.packages ?? {};
  const queue = [...rootNames]
    .map((name) => resolvePackagePath('', name, packages))
    .filter(Boolean);
  const visited = new Set(queue);
  while (queue.length > 0) {
    const packagePath = queue.shift();
    const packageMetadata = packages[packagePath] ?? {};
    const dependencyNames = new Set([
      ...Object.keys(packageMetadata.dependencies ?? {}),
      ...Object.keys(packageMetadata.optionalDependencies ?? {}),
      ...Object.keys(packageMetadata.peerDependencies ?? {}),
    ]);
    for (const dependencyName of dependencyNames) {
      const dependencyPath = resolvePackagePath(packagePath, dependencyName, packages);
      if (dependencyPath && !visited.has(dependencyPath)) {
        visited.add(dependencyPath);
        queue.push(dependencyPath);
      }
    }
  }
  return visited;
}

function lockfileAffectsFrontend(beforeValue, currentValue, frontendSource) {
  const before = parsePackageJson(beforeValue);
  const current = parsePackageJson(currentValue);
  const beforePackages = before.packages ?? {};
  const currentPackages = current.packages ?? {};
  const rootDependencies = new Set([
    ...Object.keys(beforePackages['']?.dependencies ?? {}),
    ...Object.keys(beforePackages['']?.devDependencies ?? {}),
    ...Object.keys(currentPackages['']?.dependencies ?? {}),
    ...Object.keys(currentPackages['']?.devDependencies ?? {}),
  ]);
  const frontendRoots = [...rootDependencies].filter((name) => dependencyIsFrontend(name, frontendSource));
  const frontendPackagePaths = new Set([
    ...dependencyClosure(before, frontendRoots),
    ...dependencyClosure(current, frontendRoots),
  ]);
  const packagePaths = new Set([...Object.keys(beforePackages), ...Object.keys(currentPackages)]);
  return [...packagePaths].some((path) => {
    if (!path.startsWith('node_modules/')) return false;
    const beforePackage = beforePackages[path] ?? null;
    const currentPackage = currentPackages[path] ?? null;
    if (JSON.stringify(beforePackage) === JSON.stringify(currentPackage)) return false;
    return frontendPackagePaths.has(path);
  });
}

function packageAffectsFrontend({ packageBefore, packageCurrent, packageLockBefore, packageLockCurrent, frontendSource }) {
  const before = parsePackageJson(packageBefore);
  const current = parsePackageJson(packageCurrent);
  const beforeScripts = before.scripts ?? {};
  const currentScripts = current.scripts ?? {};
  if ([...FRONTEND_BUILD_SCRIPTS].some((name) => beforeScripts[name] !== currentScripts[name])) return true;

  const beforeDependencies = { ...(before.dependencies ?? {}), ...(before.devDependencies ?? {}) };
  const currentDependencies = { ...(current.dependencies ?? {}), ...(current.devDependencies ?? {}) };
  const names = new Set([...Object.keys(beforeDependencies), ...Object.keys(currentDependencies)]);
  return [...names].some((name) => beforeDependencies[name] !== currentDependencies[name] && dependencyIsFrontend(name, frontendSource))
    || lockfileAffectsFrontend(packageLockBefore, packageLockCurrent, frontendSource);
}

export function shouldPublishAndroidRelease({ eventName, changedPaths, packageDiff = '', packageBefore = '', packageCurrent = '', packageLockBefore = '', packageLockCurrent = '', frontendSource = readFrontendSource(process.cwd()) }) {
  if (eventName === 'workflow_dispatch') return true;
  if (changedPaths.length === 0) return false;

  const appSourceChanged = changedPaths.some((path) => APP_SOURCE_PATH.test(path));
  const packageChanged = changedPaths.some((path) => path === 'package.json' || path === 'package-lock.json');
  if (!packageChanged) return appSourceChanged;

  return appSourceChanged || packageAffectsFrontend({ packageBefore, packageCurrent, packageLockBefore, packageLockCurrent, frontendSource });
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const eventName = process.env.EVENT_NAME ?? '';
  const baseSha = process.env.BASE_SHA ?? '';
  const headSha = process.env.HEAD_SHA ?? process.env.GITHUB_SHA ?? '';
  let changedPaths = [];
  let packageBefore = '';
  let packageLockBefore = '';

  if (eventName !== 'workflow_dispatch') {
    if (!/^[0-9a-f]{40}$/i.test(headSha)) throw new Error('A full HEAD_SHA is required to detect app changes.');
    if (/^0{40}$/i.test(baseSha)) {
      changedPaths = ['android/initial-commit'];
    } else {
      if (!/^[0-9a-f]{40}$/i.test(baseSha)) throw new Error('A full BASE_SHA is required to detect app changes.');
      changedPaths = execFileSync('git', ['diff', '--name-only', baseSha, headSha], { encoding: 'utf8' })
        .split(/\r?\n/)
        .filter(Boolean);
      packageBefore = readGitFile(baseSha, 'package.json');
      packageLockBefore = readGitFile(baseSha, 'package-lock.json');
    }
  }

  const packageCurrent = readFileSync('package.json', 'utf8');
  const packageLockCurrent = readFileSync('package-lock.json', 'utf8');
  const appChanged = shouldPublishAndroidRelease({
    eventName,
    changedPaths,
    packageBefore,
    packageCurrent,
    packageLockBefore,
    packageLockCurrent,
  });
  const output = `app_changed=${appChanged}\n`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output, 'utf8');
  else process.stdout.write(output);
}
