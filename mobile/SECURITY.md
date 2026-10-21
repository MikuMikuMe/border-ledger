# Mobile dependency security notes

## GHSA-vfj7-8cjw-p6xm (braces)

The upstream advisory currently lists no patched release for braces 3.0.3. This repository keeps a small MIT-licensed fork at mobile/vendor/braces, version 3.0.4+border-ledger.1. The only source change is a hard maximum brace nesting depth of 100 in the parser, before recursive compile and expansion walkers run.

mobile/package.json declares this local package directly at the application root. Its compatible 3.0.4 version satisfies the micromatch 3.x requirement, so npm can hoist one patched package for all transitive consumers. The regression tests in tests/braces-security.test.ts exercise both compile and expansion paths. npm audit reports zero vulnerabilities for the mobile lockfile after the local package is installed. Do not use npm audit fix --force: it proposes downgrading @shopify/react-native-skia to 1.12.4, which breaks the required Skia 2.14.0 pin.

The upstream issue is disputed by the package maintainer and has no released fix. Keep this fork narrow and tracked; replace it with an upstream release only after verifying that the release includes a bounded parser depth and passes these regression tests.

The affected graph is used by Metro and React Native CLI during development and bundling; it is not imported by the Android app JavaScript entry points or production Worker. Keep brace/glob patterns in build configuration trusted, and retain the dependency review/audit checks.
