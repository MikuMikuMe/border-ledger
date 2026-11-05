# Report replay after holdings resets

Verified 2026-11-04 against refreshed `origin/main` (`1ebfabb`). All data is synthetic.

The regression opens one historical share, records a CAD 50 contribution, switches to an aggregate value, reopens holdings with three shares, and applies a 1:3 reverse split. Before the fix, the report replayed four shares and threw an exact-decimal precision error. The endpoint now uses its segment-scoped snapshot and calculates cash-flow analytics separately from the complete ledger. Earlier capital flows remain included.

- Complete Wealth/mobile partition: 15 files, 286 tests passed (117.63 seconds).
- Root typecheck and web build passed. Existing 529 kB bundle advisory remains.
- CodeScene: three executable files scored 10.0 with no findings; export-only barrel has no score. Four-file pre-commit safeguard passed.
- Android API 35 emulator, existing verified embedded QA APK, actual React Native Wealth screens and real Worker handler backed by disposable SQLite: Overview loads CAD 150.00; Investments shows one TSX:RY share, CAD 150.00 basis and market value, and zero gains. Force-stop/relaunch retains the CAD 150.00 view.
- Server-only change; no native sources or dependencies changed. Existing theme/accessibility/native build evidence remains in earlier QA records; that full matrix was not repeated here. No production authentication, live quotes or offline persistence claim.

Evidence: [report JSON](report.json), [Overview](overview.png), [holdings](holdings.png), [relaunch](relaunch.png). Matching XML trees are retained beside screenshots. The synthetic service retains data across app relaunch, not server restart.
