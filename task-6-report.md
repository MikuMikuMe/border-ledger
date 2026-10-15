# Task 6 parser review report

Status: remaining Task 6 parser finding fixed only; all other work was preserved.

- `BocCreditCardParser.parseComponents` now canonicalizes both explicit leading/trailing currency tokens before selecting money. Unequal or unresolved explicit pairs return `NeedsReview` with `AMBIGUOUS_CURRENCY` and no money component; matching aliases/full-width forms and single valid tokens remain accepted.
- Synthetic regressions cover `CAD 12.00 USD`, full-width `ＣＡＤ １２．００ ＵＳＤ`, alias `加元 12.00 美元`, plus matching and single-token cases.

Bounded checks:

- `android/task5-static-check.ps1` — PASS: `TASK5_STATIC_OK production_manifest=ok debug_probe_isolated=ok crypto_storage=ok auth_boundaries=ok ui_motion_onboarding=ok synthetic_tests=present`.
- `node .\node_modules\typescript\bin\tsc --noEmit --project .\tsconfig.json` — PASS.
- `android> .\gradlew.bat :app:testDebugUnitTest --tests '*SyntheticBocCreditCardParserTest.mismatchedLeadingAndTrailingCurrenciesStayAmbiguousAfterNormalization' --tests '*SyntheticBocCreditCardParserTest.matchingLeadingAndTrailingCurrenciesAndSingleValidTokensRemainComplete'` — BLOCKED before compilation: UNC working directory unsupported and `gradle-wrapper.jar` missing; no Kotlin test assertions ran.
- `npm run typecheck` is blocked by the same UNC `cmd.exe` behavior; `npm test` is blocked at Vitest startup by the existing missing `@jridgewell/trace-mapping/dist/trace-mapping.mjs`.

No Android compilation, real BOC/source validation, Pixel/emulator validation, listener/network/raw-payload work, reset, or revert is claimed. Changed files are limited to the parser, its synthetic test, and this report.
