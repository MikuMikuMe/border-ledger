# Mobile dependency security notes

## GHSA-vfj7-8cjw-p6xm (`braces`)

Status as of 2026-10-16: deferred, with the mitigation below.

The fresh command `npm audit --omit=dev --json` reports 24 high-severity
*findings* in the mobile graph, but they are propagated package paths rather
than 24 distinct advisories. The common advisory is GHSA-vfj7-8cjw-p6xm
(CVE-2026-93687), affecting `braces <=3.0.3` with a stack-exhaustion DoS in
deeply nested brace patterns. The official advisory currently lists no
patched version: <https://github.com/advisories/GHSA-vfj7-8cjw-p6xm>.

The installed path is:

```text
braces@3.0.3
└─ micromatch@4.0.8
   ├─ fast-glob@3.3.3 ← @react-native-community/cli-clean/config/doctor
   │  └─ @react-native-community/cli@20.2.0 (dev dependency)
   └─ metro-file-map@0.87.1 ← metro@0.87.1 (Metro bundler)
```

`npm audit` offers no compatible patch for the required Task 1 graph. Its
only direct remediation for this path is the breaking downgrade
`@shopify/react-native-skia@1.12.4`, which violates the required Skia `2.14.0`
pin and was not applied. There is no safe override to a patched `braces`
release while the advisory lists none; forcing an unpublished or incompatible
version would make the lockfile unverifiable. Revisit this note when braces,
Metro/RN CLI, or Skia publishes a compatible fix.

### Exposure and mitigation

- `braces`, `micromatch`, `fast-glob`, and Metro's file-map code execute in the
  Node-based CLI/bundling and development-server paths. They are not imported
  by the Android app's JavaScript entry points or native production services.
- The release bundle at
  `android/app/build/outputs/react-native/index.android.bundle` was searched
  for `node_modules/braces`, `node_modules/micromatch`, and `braces@3.0.3`;
  none were present. This is a bundle-boundary check, not a claim that the
  Node build graph is vulnerability-free.
- The current mitigation is to keep the mobile graph isolated, keep the
  affected tools out of shipped JS/native runtime artifacts, and run the
  audit as part of mobile dependency review. Do not feed attacker-controlled
  brace/glob patterns to local build tooling; report any future tool or
  service that does so before enabling it.

### Diagnostic evidence

The commands and key outputs from the fix round are recorded in
`.superpowers/sdd/2026-10-16-react-native-migration/task-1-report.md`:

```text
npm audit --omit=dev --json
audit exit: 1; high: 24; critical: 0; total: 24
braces: 3.0.3; GHSA-vfj7-8cjw-p6xm; range <=3.0.3
fixAvailable: @shopify/react-native-skia@1.12.4 (isSemVerMajor: true)

npm explain braces --omit=dev
braces@3.0.3 <- micromatch@4.0.8 <- metro-file-map@0.87.1 / fast-glob@3.3.3

release bundle marker scan
node_modules/braces: false
node_modules/micromatch: false
braces@3.0.3: false
```
