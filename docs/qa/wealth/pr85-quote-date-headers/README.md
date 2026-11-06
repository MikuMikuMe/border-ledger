# Provider quote dates and custom CSV headers

PR 85 review follow-up, 2026-11-06. All data and provider responses are synthetic.

## Fixes

- Provider observations remain cached by security. Account-specific valuation history is inserted only when that account was in holdings mode on the provider's quote date. The predicate runs inside the insert, with the same before/on/after transition ordering used by manual valuation validation. It also permits valid historical holdings observations when the account is currently aggregate. Existing manual-value precedence and authority guards remain in place.
- Native remapping validates canonical keys separately from source-header values. Source values may contain punctuation, accents, other scripts, quotes, and names longer than 128 characters. They must remain nonblank strings, and the whole mapping stays bounded to 64 KiB of UTF-8 JSON. Non-string values remain rejected.
- The related Not mapped action is consistent across the native and Worker boundaries. Explicit null values disable automatic canonical fallback, remain in metadata, and survive recovery of the same operation. Unknown canonical names and normalized duplicate canonical assignments still fail validation.

## Regression evidence

Seven quote cases cover both transition directions, the first holdings day, repeated representation changes, retained generic cache observations, and fresh-ledger canonical export/import of valid valuation history. The pre-fix run reproduced four failures. The provider transport is mocked; no live Alpha Vantage key or request was used. Generic quote-cache data is not treated as an account observation in an aggregate segment.

The native pre-fix run failed on the valid punctuation/Unicode mapping. The final emulator run passes 20 tests: four mapping contract tests plus the existing 16 CSV payload/response/encryption tests. The actual native remap method calls the tested parser. The four new tests also check nulls, invalid types/keys, long source headers, and the UTF-8 byte limit.

The mapping recovery test reproduces and fixes a separate read-back boundary: it retries the same operation identity, then feeds its resolved mapping into another preview. A null field remains null and the omitted canonical column does not silently reappear.

## Hands-on emulator verification

The [custom-header CSV](custom-headers.csv) initially produced row validation errors. In Android's document picker and mapping UI:

1. Selected `quantité` for `quantity`, `amount (cad)` for `basis_minor`, and Not mapped for optional `memo`.
2. Used Back to dismiss the software keyboard before selecting source options; the picker remained open and the selection then closed it.
3. Re-preview returned three ready rows, zero errors, and zero duplicates.
4. Confirmed the import. Overview showed CAD 50.00. The [real Worker report](imported-report.json) retained quantity 0.5, CAD 100.00 basis, CAD 50.00 value and CAD -50.00 unrealized gain.
5. Force-stopped and relaunched in dark mode; CAD 50.00 persisted. Back returned to More.

The UI uses the existing debug SAF adapter and loopback server with real Worker handlers. The production native validation boundary is verified separately by Android instrumentation; this does not imply production authentication or live market-data testing. Screenshots and UI hierarchies are retained here. Earlier large-file, TalkBack and large-text checks are in the preceding [lifecycle/import verification](../pr85-lifecycle-import/README.md).

## Verification discipline

Review and focused regression work finish before the final full-suite source freeze. Source files remain unchanged for that run; their hashes are recorded with the results. Earlier runs that captured the pre-fix null parser/reader are not counted as passing. Local SDK/AVD/cache settings, APKs and signing material stay on D: and are excluded from commits. No migration or production deployment is needed for this patch.

## Final results

[Verification results](verification-results.json): 224 repository files / 1,707 tests passed in 469.99 seconds, exit code 0. All eight source hashes remained unchanged for the final run. Android lint, 378 native/shared unit tests, debug/test/release builds, web/mobile typechecks, production web build and 20 emulator boundary tests passed. The eight per-file CodeScene scores are 10.0 and the pre-commit gate passed. Independent review found no remaining concrete issues in these paths. Existing web chunk-size and Gradle deprecation advisories remain.

The emulator and loopback server were stopped after verification. Provider failures, quotas and credential protection retain their existing tests; the new quote transport cases use mocked provider responses because no live user key was supplied. Hosted checks will run on push and are not awaited here. No merge or production deployment was performed.
