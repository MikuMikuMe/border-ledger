# Lifecycle contracts and completed large-import verification

PR 85 follow-up, 2026-11-06. All records and documents are synthetic; no production credentials, sign-in or live market data are involved.

## Why findings kept appearing

The two latest accounting defects were present in the original feature commit `7613c7a8`, as confirmed with `git blame`; the preceding CSV patch did not introduce them. Earlier tests covered individual corrections, reversals and cash balances but omitted interactions between controls and the distinction between known zero and unavailable value. Fixing the reviewed example did not establish a shared contract across replay, writes, reports, imports and audit readers. The broad feature PR made those gaps expensive to discover one comment at a time.

This follow-up checks sequences across those boundaries before pushing:

| Contract | Regression coverage |
| --- | --- |
| Undo a control restores the preceding state | Reversal chains; correction/correction/reversal; correction/reversal/reversal; correction of a reversal; reversed input order |
| Known zero is an observation; unknown is unavailable | Full withdrawal yields CAD 0 and 0% dated return; an unpriced holding remains incomplete |
| Every reader uses the same effective ledger | Snapshot/report agreement at each historical cutoff; canonical export/import round trip |
| Bank transaction belongs to a control lineage | Non-adjacent corrections retain/reuse alias-equivalent links; imports extend stored controls; unrelated roots still conflict |
| Audit history includes controls affecting the selected scope | Original/replacement accounts and instruments; real HTTP route forwarding; web security drilldown retains reversals |
| A stalled fixture request has a bounded outcome | 15-second abort covers upload and response body; retry uses the same operation identity |

The shared resolver now interprets complete control chains. A shared ancestor traversal supplies bank ownership and audit scope. This replaces separate immediate-target assumptions. No new database migration is required.

For future financial slices, establish these sequence contracts before implementation, test the complete public path, and review neighboring states before pushing. A green test count or CodeScene score alone does not establish accounting correctness. Smaller feature PRs would also make complete reviews easier.

## Upload diagnosis

The old synthetic fixture had no fetch deadline, so a blocked request could leave `Saving Wealth change...` indefinitely. Windows also reached its system commit limit, and an undersized guest then thrashed during startup. The earlier upload had no byte trace; its exact original transport stall cannot be established retrospectively.

With sufficient host memory, the existing 1,100,271-byte CSV uploaded as 1,100,349 JSON bytes in 753 ms and returned 201. Preview showed two ready rows, zero errors and zero duplicates. Confirmation succeeded, Overview showed CAD 100.00, and the value survived force-stop/relaunch in dark mode. A synthetic 503 produced Retry Wealth; clearing the failure restored CAD 100.00. Android Back returned to More. Screenshots and hierarchies are in this directory.

The fixture service now aborts every request after 15 seconds, including response-body reads and writes. This is a debug-only fixture change; production native HTTP/storage boundaries retain their existing regression coverage. A timed-out write must be reconciled or retried by its operation identity, never assumed to have failed before commit.

## Repeatable local server

Run `node scripts/qa/wealth-import-server.mjs` from a local checkout. It binds **127.0.0.1:18094** and creates a disposable synthetic SQLite ledger using the real Wealth handlers. No production connections or quote refreshes are configured. `WEALTH_QA_PORT` can override a Windows-reserved port.

Reverse emulator port 8794 to host port 18094 with adb. Install the isolated `.probe.wealthqa` debug APK, then launch `ReactNativeActivity` with action `com.lofuyu.borderledger.debug.SHOW_WEALTH_FIXTURE`. The optional boolean `dark` selects the theme. Regenerate the embedded React Native debug bundle **before** APK packaging; verify the APK contains the new timeout message. Do not reuse an old embedded asset when claiming a new app version was verified.

POST JSON to `/__qa/failures`: `{"wealthStatus":503}` injects a service failure; `{"delayPreview":true}` delays preview for 16 seconds to exercise the 15-second client timeout; `{}` resets both. These controls exist only in this loopback QA runner. Restarting the runner clears its synthetic database; app relaunch verification keeps the runner alive.

Local build settings, SDK/AVD/Gradle caches, APKs, the raw large CSV and crash dumps remain on D: and are excluded from commits. The raw CSV SHA256 is recorded separately.

## Final results

[Verification results and APK/bundle hashes](verification-results.json): 223 repository files / 1,696 tests passed; 378 native/shared unit tests passed; 16 final-APK emulator boundary tests passed in 23.398 seconds with the unchanged 192 MiB app heap. Web/mobile typechecks, production web build, Android lint and debug/test/release builds passed. The existing web chunk-size advisory remains.

On the final packaged APK and committed QA server:

- A delayed 1,100,349-byte preview request left the saving state at the 15-second client deadline, showing reconciliation guidance. The server completed after 16,217 ms; a timeout was not treated as proof that the operation never reached the server.
- After reviewing the current report and clearing the delay, the same file previewed successfully in 304 ms. Remapping posted 1,100,635 bytes and returned 201 in 287 ms. Two ready rows, zero errors and zero duplicate candidates were shown.
- Confirmation displayed CAD 100.00. Importing [the synthetic lifecycle controls](lifecycle-controls.csv) then withdrew all cash, reversed the withdrawal and reversed that reversal. Overview correctly displayed CAD 0.00, and [the final report](zero-report-final.json) retained explicit zero cash and an available 0% Modified Dietz return.
- The final state persisted after force-stop/relaunch in dark mode at 1.3x text. Tabs wrapped and the balance remained readable. With TalkBack enabled and touch exploration active, keyboard focus moved through More to Wealth; Enter opened it and Back returned to More. See [focus sequence](talkback-keyboard-focus.txt), [service state](talkback-service.txt) and the `android-*-final` screenshots/hierarchies.
- A synthetic service 503 and recovery were exercised earlier in the same follow-up; screenshots retain the error and recovered CAD 100.00 state. The earlier screenshots without `final` suffix precede the rebuilt timeout code and are diagnostic evidence, not the final APK claim.

The final crash buffer was empty. Temporary font/accessibility/notification settings were restored, and the task emulator/server were stopped. This completes the previously unresolved large-file fixture verification. Production sign-in and live quotes remain outside this synthetic follow-up.
