# Historical cash flows and native CSV boundaries

The large-file UI limitation recorded here is resolved by [the later lifecycle/import verification](../pr85-lifecycle-import/README.md). Historical results below are retained.

Follow-up verification for PR 85 against `origin/main` (`1ebfabb`). All financial records, credentials and file contents used for testing are synthetic.

## Fixes and review

- Report cash flows now respect the as-of cutoff even when the requested end date is absent or later. The requested start/end range still applies, including its boundary dates.
- CSV preview commands and the server's JSON envelope allow bounded encoding overhead for the existing 2 MiB CSV limit. Ordinary native writes remain limited to 256 KiB.
- Only the exact native CSV-preview POST route receives a 32 MiB response allowance. Ordinary responses remain capped at 2 MiB. Preview cache records have a matching 32 MiB allowance; ordinary records remain at 2 MiB and capture records at 16 MiB.
- Initial and retried previews share compact error/duplicate summaries. Complete `rows`, source amounts, memos and duplicate/error identities are retained. This avoids repeatedly serializing the same financial payload in summary arrays.
- The encryption ceiling includes the 16-byte GCM tag. Allowed record names already extend to 96 characters; the Keystore wrapper now accommodates their 17-character prefix without renaming persisted keys or changing the accepted alphabet or encryption format.
- Decryption authenticates the existing envelope directly by offset, avoiding a redundant full ciphertext copy. The maximum-preview test originally exhausted the unchanged 192 MiB app heap; all 16 native boundary tests now pass, including the 32 MiB round trip. Truncated and oversized envelope metadata remain rejected.
- Wealth document processing, preview reads and remapping perform file/crypto work on the IO dispatcher. Picker launching stays on the UI dispatcher, and owner fencing is retained.

Self-review and independent Ponytail review traced the actual callers, including preview retries, native transport, encrypted persistence, real hashed key names and dispatchers. The review found the downstream response/cache bounds, alias mismatch and UI-dispatcher work; each was addressed within this patch.

## Reproductions

A valid 4,500-row CSV was 267,847 bytes and produced a 2,262,374-byte preview with no row or portfolio errors. It crossed both old native response/cache limits. See [size measurement](preview-size.json).

Two near-2-MiB escaped-memo cases produced approximately 37.7 MB (duplicate summary) and 50.3 MB (error and duplicate summaries) before compaction. Regression tests now keep their responses below 32 MiB, preserve the memo, and compare initial/retried previews.

Native tests reproduced rejection of a supported CSV command, then the response/cache limits, and finally the real hashed source-record key. The original upload failure and the invalid key-name failure are retained in the before logs. Maximum preview response/storage, encryption tag overhead, maximum record-name aliases, and ordinary-limit rejection have dedicated native boundary checks.

## Verification scope

The native instrumentation tests exercise the actual HTTP transport against an emulator-local socket and actual Android Keystore-backed encrypted storage in an isolated debug app. No production sign-in, live quotes, external market-data call or deployment is involved.

The document-picker/screens check uses the established synthetic fixture adapter with the real Worker handlers. It complements the production native boundary tests; it does not imply end-to-end production authentication. Existing theme, large-text and TalkBack evidence remains in earlier Wealth QA records.

SDK, AVD, Java, Gradle caches, APKs and local fixtures stay on D:. Local configuration, signing material, raw large fixture payloads and JVM crash dumps are excluded from the commit.


## Current verification

- [Full repository suite: 221 files and 1,678 tests passed](repository-tests.txt), exit code 0.

- [38 focused server tests passed](focused-tests.log), including as-of boundaries, encoded CSV limits and compact preview diagnostics.
- [16 native emulator tests passed](native-tests.log), including exact and excessive response/cache sizes, real hashed aliases, legacy encryption and metadata rejection.
- [Native lint, 378 native/shared unit tests, debug/test/release builds, web/mobile typechecks and web build passed](build-results.txt).
- Per-file CodeScene reviews: all 14 changed source files score 10.0. Pre-commit safeguard passed for all 14.

### UI verification limitation

Android's document picker accepted the 1,100,271-byte synthetic CSV. The debug fixture received its POST request, but the body stalled over the adb reverse connection after repeated attempts. Confirmation and persistence after relaunch were **not verified** in this follow-up. See [pending-upload screenshot](android-large-upload-pending.png) and [UI hierarchy](android-large-upload-pending.xml). This is separate from the passing production native HTTP/Keystore boundary tests above. No production authentication or live quote testing was attempted.

The emulator and QA service were stopped before rerunning the repository suite. An earlier concurrent run exhausted Windows system commit memory; its aborted result is not counted as passing. The fresh complete run passed all 1,678 tests in 907.61 seconds.
