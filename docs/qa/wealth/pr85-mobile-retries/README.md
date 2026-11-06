# Android definitive-write retries

Verification date: 2026-11-05. All emulator data and injected failures are synthetic.

The screen now retires the matching draft operation identity after `completed`, `rejected`, `revision_conflict`, `failed_local`, or `canceled`. Unknown and reconciliation-required outcomes retain their identity. A delayed receipt cannot retire a newer operation from the same editor.

Regression tests first reproduced reused IDs after both rejection and revision conflict. The final retry-focused suite covers changed and unchanged rejected submissions, refreshed revisions, all definitive statuses, unresolved identities, stale receipts, correction/reversal/export scopes, and the debug transport's native-shaped failure receipts. The debug adapter now returns confirmed failure operations instead of hiding them behind a thrown transport error. Production native journal semantics are unchanged.

## Android verification scope

The API 35 emulator uses the actual React Native shell, Wealth screen and typed editor from a newly bundled debug APK. The loopback transport and disposable SQLite Worker service are synthetic; they exercise screen operation IDs and server write behavior. Native operation-journal unit tests separately cover journal fingerprints and terminal outcomes. This fixture does not claim production session or encrypted-journal end-to-end coverage.

## Results

- Final Wealth/mobile partition: 15 files / 305 tests passed (293.34 seconds).
- Retry-focused suite: 3 files / 64 tests passed.
- Web and mobile typechecks passed; web build passed with its existing 529 kB chunk advisory.
- Android debug package and 17 native journal tests passed (zero failures/errors), Gradle 3m 11s. No native source changes; release/lint/accessibility/theme evidence remains in earlier QA records and was not repeated here.
- All five modified source/test files scored CodeScene 10.0; five-file pre-commit safeguard passed.
- Emulator submissions from one unchanged editor: CAD 50 rejected; corrected CAD 70 committed; forced conflict then unchanged CAD 70 committed; a real stale-revision conflict at revision 9 then a fresh-ID retry at revision 10 committed. Six unique operation IDs, exactly three successful CAD 70 entries. Starting CAD 150 plus CAD 210 contributions gives CAD 360, revision 11; force-stop/relaunch retained that total.
- Native journal fingerprints were verified by native unit tests; the emulator uses the documented synthetic transport adapter.

Evidence: [attempt IDs and payloads](attempts.json), [final report](report.json), [rejection](rejected.png), [conflict](conflict.png), [real server conflict](real-revision-conflict.png), [saved retry](retry-saved.png), and [relaunch](relaunch.png). Matching UI trees, test logs, native JUnit XML and the APK SHA-256 are retained alongside these files. APK hash: `ABE737531583A7D19C69CC79A36B45586C4BA223A5430AA74F080211D24709EE`.

No production sign-in, production data, secrets, live market requests or deployment were involved.
