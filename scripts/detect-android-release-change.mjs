const BACKEND_ONLY_PATH = /^(?:worker\/|wrangler\.jsonc$|\.github\/workflows\/deploy\.yml$|tests\/(?:worker-|ledger-|fx-))/;
const FRONTEND_PACKAGE_LINE = /^(?:\+|-)\s*"(?:(?:node_modules\/)?(?:@types\/react(?:-dom)?|@vitejs\/plugin-react|lucide-react|react(?:-dom)?|vite|typescript|jsdom|vitest)|scripts|version)"\s*:/;

export function shouldPublishAndroidRelease({ eventName, changedPaths, packageDiff = '' }) {
  if (eventName === 'workflow_dispatch') return true;
  if (changedPaths.length === 0) return true;

  const packageChanged = changedPaths.some((path) => path === 'package.json' || path === 'package-lock.json');
  if (!packageChanged) return true;

  const nonPackagePaths = changedPaths.filter((path) => path !== 'package.json' && path !== 'package-lock.json');
  const frontendPackageChanged = packageDiff.split(/\r?\n/).some((line) => FRONTEND_PACKAGE_LINE.test(line));
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
  });
  process.stdout.write(`app_changed=${appChanged}\n`);
}
