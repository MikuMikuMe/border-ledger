const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { withUniwindConfig } = require('uniwind/metro');
const fs = require('node:fs');
const path = require('node:path');

const mobileRoot = __dirname;
const nodeModulesPath = path.resolve(mobileRoot, 'node_modules');
const resolvedNodeModulesPath = fs.realpathSync(nodeModulesPath);
const relativeNodeModulesPath = path.relative(mobileRoot, resolvedNodeModulesPath);
const nodeModulesOutsideProject = relativeNodeModulesPath === '..'
  || relativeNodeModulesPath.startsWith(`..${path.sep}`)
  || path.isAbsolute(relativeNodeModulesPath);

module.exports = withUniwindConfig(mergeConfig(getDefaultConfig(__dirname), {
  // Metro's file map does not follow a node_modules junction unless its real
  // target is a watch root. Normal installs remain under mobileRoot and need
  // no extra root; D-drive shared dependency caches do.
  watchFolders: [
    ...(nodeModulesOutsideProject ? [resolvedNodeModulesPath] : []),
    path.resolve(mobileRoot, '..', 'shared'),
    path.resolve(mobileRoot, '..', 'contracts'),
  ],
  resolver: {
    // Resolve aliases at the graph boundary as well as in Babel. This also
    // covers modules returned from Uniwind's persistent transform cache.
    resolveRequest(context, moduleName, platform) {
      const request = moduleName.startsWith('@/')
        ? path.resolve(__dirname, 'src', moduleName.slice(2))
        : moduleName;
      return context.resolveRequest(context, request, platform);
    },
  },
}), {
  cssEntryFile: './global.css',
});
