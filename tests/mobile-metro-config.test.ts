import { describe, expect, it } from 'vitest';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../mobile');
const metroConfig = require('../mobile/metro.config.js') as { watchFolders: string[] };

describe('React Native Metro dependency roots', () => {
  it('watches node_modules outside the project when dependencies use a junction', () => {
    const realNodeModules = realpathSync(path.join(mobileRoot, 'node_modules'));
    const relativeNodeModules = path.relative(mobileRoot, realNodeModules);
    const isOutsideProject = relativeNodeModules === '..'
      || relativeNodeModules.startsWith(`..${path.sep}`)
      || path.isAbsolute(relativeNodeModules);

    if (isOutsideProject) expect(metroConfig.watchFolders).toContain(realNodeModules);
  });
});
