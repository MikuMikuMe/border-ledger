const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { withUniwindConfig } = require('uniwind/metro');
const fs = require('node:fs');
const path = require('node:path');
const metroConfigRoot = path.dirname(require.resolve('metro-config'));
const exclusionList = require(path.join(metroConfigRoot, 'defaults', 'exclusionList.js')).default;

const mobileRoot = __dirname;
const nodeModulesPath = path.resolve(mobileRoot, 'node_modules');
const resolvedNodeModulesPath = fs.realpathSync(nodeModulesPath);
const relativeNodeModulesPath = path.relative(mobileRoot, resolvedNodeModulesPath);
const nodeModulesOutsideProject = relativeNodeModulesPath === '..'
  || relativeNodeModulesPath.startsWith(`..${path.sep}`)
  || path.isAbsolute(relativeNodeModulesPath);
const escapeRegExp = value => value.replaceAll(path.sep, `\\${path.sep}`).replaceAll('.', '\\.');
const separatorPattern = path.sep === '\\' ? '\\\\' : '/';
const generatedBuildOutputs = [
  path.resolve(mobileRoot, '..', 'shared', 'core', 'build'),
  path.resolve(mobileRoot, '..', 'android', 'build'),
  path.resolve(mobileRoot, '..', 'android', 'app', 'build'),
].map(directory => new RegExp(`${escapeRegExp(directory)}${separatorPattern}.*`));

module.exports = withUniwindConfig(mergeConfig(getDefaultConfig(__dirname), {
  // Metro's file map does not follow a node_modules junction unless its real
  // target is a watch root. Normal installs remain under mobileRoot and need
  // no extra root; D-drive shared dependency caches do.
  watchFolders: [
    ...(nodeModulesOutsideProject ? [resolvedNodeModulesPath] : []),
    path.resolve(mobileRoot, '..', 'shared'),
    path.resolve(mobileRoot, '..', 'src', 'domain'),
    path.resolve(mobileRoot, '..', 'contracts'),
  ],
  resolver: {
    // Gradle/codegen output lives under watched shared and Android roots. It
    // is never a Metro dependency and can otherwise trigger repeated HMR
    // invalidations while an emulator is attached.
    blockList: exclusionList(generatedBuildOutputs),
    nodeModulesPaths: [nodeModulesPath],
    // Resolve source aliases at the module graph boundary.
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
