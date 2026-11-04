# PR 85 final accounting and hosted-gate follow-up

Reviewed head: `89e90edad22c365e08a30163233c9c4eb5b3d62c`. Base: `origin/main` at `1ebfabbaf98e57004709f61510c9f82d7e201319`. Local date: 2026-11-04.

## Reported failures reproduced before changes

The hosted CodeScene analysis for the reviewed head failed because `eventsForCurrentModeSegment` had five arguments; the configured maximum is four. The previous local analyzer reported 10.0 and missed that hosted finding. All applicable GitHub Actions checks on that head passed. Old open argument-type comments refer to earlier revisions; the latest hosted analysis reports only the projection helper finding.

Using real Wealth Worker handlers with a disposable synthetic SQLite D1 fixture:

1. Import [reset-regression.csv](reset-regression.csv). Source opens two shares, transfers one to the destination, and the destination transitions to aggregate then returns to holdings with a fresh one-share opening. At CAD 100 per share, plus a separate CAD 20 cash balance, the expected total is CAD 220. Before the fix, the API returned CAD 320 because the old incoming leg entered the destination's new segment.
2. The cash account opens CAD 100 on November 1 and withdraws CAD 80 on November 3. Appending a CAD 50 withdrawal dated November 2 returned HTTP 201 and advanced the revision; the following report returned HTTP 400 `negative_cash`. [invalid-backdate.csv](invalid-backdate.csv) supplies the same invalid event for import-preview verification.

No production account, credential or financial record is used by these fixtures. Quote testing remains mocked/manual; no user Alpha Vantage key was supplied.

## Final implementation and local checks

The shared replay validator validates subsequent activity and historical states across original control-record dates, resolved effective dates and representation transitions before append/import writes. Historical transfer dependencies use isolated replay-only segment accounts to retain quantity and weighted-average basis without adding an old leg to a fresh opening. The registry and projected events share collision-safe identities; those identities are filtered out of public results and never persisted as ledger accounts.

`eventsForCurrentModeSegment` now has three parameters: events, a typed projection context and the observation date. The hosted rule's maximum remains four. No CodeScene rule or threshold was suppressed.

| Check | Final result |
| --- | --- |
| Complete Wealth/mobile regression partition | 13 files / 250 tests passed, 106.09 seconds after the final review hardening. |
| New targeted regressions | 11 passed: cash withdrawal, opening correction, later sale, reversal-hidden checkpoint, old reset segment, valid backdate, source/destination reset basis, real-account and event-source identifier collisions, and recursive cash-transfer deduplication. |
| Root and mobile typechecks | Passed after the final edits. |
| Production web build | Passed; inherited 529 kB chunk advisory remains. |
| Per-file CodeScene review and score | All five changed executable files scored 10.0 with no findings. See [evidence](codescene-files.json). |

The existing Android/native sources and mobile bundle are unchanged by this follow-up. The emulator reuses the previously built isolated API 35 QA package and embedded debug bundle (SHA-256 `ECD594C887BAD464AA5D38454886B8B9784F45139B0553426DEA0B616F14A027`); the Worker calculations run from the final source against a fresh synthetic SQLite D1 fixture. Production authentication is covered separately by the existing native/API tests. Full native builds and accessibility/theme checks from the preceding review are retained in the [previous verification record](../pr85-review/README.md).

## Review hardening and replay performance

Independent review found that generated event source IDs could collide with user-supplied source IDs. Selection now uses a structured key containing the original event identity and projected account scope. Once controls are resolved, each replay receives unique internal event identities. A regression first reproduced a real contribution disappearing under such a collision, then passed after the fix.

Replay validation no longer replays every ordinary transaction date. Each replay already validates all intermediate cash/position states; additional checkpoints cover both sides of control-record and representation-transition boundaries. Raw and resolved predecessor dates retain coverage for historical states hidden by later reversals/corrections. Per-account segment timelines and dependency-event indexes avoid repeated full-history scans, and a prebuilt account registry avoids repeated normalization for each event. A current source segment already selected for replay is not added again through a historical intermediate dependency.

[Local synthetic benchmark evidence](replay-benchmarks.json): 1,000 distinct-date cash events took 4,804 ms before optimization and 17 ms afterward; 10,000 took 166 ms afterward. A chain of 1,000 historical position transfers took 48 ms. Cash inputs use consecutive dates from 2020-01-01, one opening of 100,000 minor units, then withdrawals of one minor unit. Transfer-chain inputs move one opening share through distinct accounts, then switch all source accounts to aggregate on the same final date. These are local diagnostic timings, not hosted latency guarantees. Cost still grows with the number of distinct control/transition states that must be checked.

## Focused Android acceptance on the final Worker

- Actual More → Wealth → Investments → Android Downloads picker previewed the 12-row reset fixture with 12 ready, 0 errors and 0 duplicates, then committed it.
- [Corrected net worth](corrected-net-worth.png) displayed CAD 220.00 as of 2026-11-03: one CAD 100 share in each brokerage account plus CAD 20 cash. Accessible UI trees are retained beside screenshots.
- The invalid backdated withdrawal preview showed 0 ready rows and an explicit validation error; [Commit was disabled](rejected-backdate.png), confirmed by `enabled=false` in the [UI tree](rejected-backdate.xml).
- A direct append against the final optimized handler returned HTTP 400 `negative_cash`. The [API evidence](api-rejection.json) shows revision 1 unchanged, CAD 220 unchanged, one share per account, and CAD 20 cash.
- After force-stop/relaunch against the final source, [Wealth still displayed CAD 220](relaunch.png). App-scoped [logcat](relaunch-logcat.txt) is retained. This verifies app relaunch with the retained local server fixture, not offline synchronization or production sign-in.

SDK, AVD, Java, Gradle, APK and checkout stayed on D:. All data is synthetic. No native/mobile source changed, no paid service was enabled, and no production merge or deployment occurred.

Independent initial review findings about event identity and scaling were fixed and a scoped re-review was clean. [Pre-commit safeguard](codescene-safeguard.json) records the final local gate. Whole-branch CodeScene analysis is run against `origin/main` after the commit and reported in the PR. Hosted checks for the pushed update are left pending for the user; this task does not wait for or poll them.
