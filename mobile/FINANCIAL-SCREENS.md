# Financial screen boundaries

`FinanceScreen` mounts Overview, Activity and Recurring in the signed-in shell. `FinanceController` consumes a structurally checked subset of the existing TurboModules. Its contracts and models are free of React Native ambient declarations so the separate React 18 web package can execute their fixtures without loading React 19 or native globals.

Reports use native reporting timezone/week-start preferences and server full-window totals. Preferred currency never enables FX implicitly. Source lanes remain separate; explicit targets use server conversions, coverage and purchase-date locks. Amount strings use shared currency metadata and exact integer arithmetic. Hermes locale formatting uses small numeric samples for punctuation only, since its Intl implementation rejects BigInt arguments.

Activity sends search/currency/category/state/source filters to the server, resets paging on filter changes, preserves server order and newer revisions, and exposes a native modal for provenance/category/note editing. Category/note drafts survive conflicts. Recurring exposes all registered currencies, classification filters, paging, monthly/yearly/subscription estimates, actual posted cost, upcoming and amount changes. Its summary window retains the Compose one-year-back/next-30-days policy in Toronto. `onOpenRecurring(id)` now opens Task 6's full detail/history modal in the shell, with source metadata, history paging and classification at the displayed revision.

Financial writes use a native operation ID and the displayed expected revision. Before enabling writes the controller reads every native operation page. Running or ambiguous annotation/classification/Review/Plaid/account operations block additional writes. Lost promises query their receipt and never replay a write. An unresolved native receipt stays unresolved even if an entity appears changed; current state cannot prove the outcome of an individual write.

`DetailsScreen` structurally checks the existing NativeRecurring/NativeReview/NativeAccounts/NativeSession modules. Review presents authoritative evidence, bounded candidates/links, supported keep-separate/ignore/link decisions, and category/note editing at the transaction annotation revision. Classification of alert events remains explicitly unavailable, as in Compose. Highest observed alert/stream revisions survive full refresh; new page membership/order and cursors remain server-controlled. Protected authorization failures clear all details resources, reject later writes, and fence late reads/events. Cached/offline rows remain readable with actions disabled.

Accounts exposes native metadata only (name, mask, subtype, source currency/kind/provider ID), connection status/errors/cleanup/expiry/last-sync, reconnect, queued sync and confirmed disconnect. It does not invent balances or account-to-connection ownership absent from the DTO. The existing Android official Plaid lifecycle owns authorization and exchange. JavaScript sees fixed success/canceled/failed/unsupported snapshots and account metadata; provider tokens remain native. Pending account choices start empty, reset per pending ID, and are checked against the returned account set before submission. Refresh submitted operation status after an external callback; a success event alone never resolves a durable ambiguous receipt. SDK cancellation and canceling the unactivated pending connection are distinct; neither undoes a submitted financial write.

## Synthetic renderer checks

Only a debug build loads `src/dev/FinanceFixtureHost`. It imports no native service, visibly labels synthetic data, and supplies no-op financial actions. It is not an authenticated fallback. With the debug host and Metro running:

```text
node scripts/react-native-finance-fixture.cjs overview ready light
node scripts/react-native-finance-fixture.cjs activity detail dark
node scripts/react-native-finance-fixture.cjs recurring stale light
node scripts/react-native-finance-fixture.cjs recurring-detail ready dark
node scripts/react-native-finance-fixture.cjs review detail light
node scripts/react-native-finance-fixture.cjs accounts pending dark
node scripts/react-native-finance-fixture.cjs hide
```

States: `ready`, `empty`, `loading`, `offline`, `error`, `locked`; recurring also `waiting`, `incomplete`, `stale`, `unavailable`; Activity detail also `detail`, `conflict`, `saving`, `unresolved`. Models/components are tested with the same deterministic fixtures. Native Text uses system font scaling; controls have 48dp minimum targets; filter selection has radio semantics; statuses have live regions; chart data has a signed textual alternative. Detail is a scrollable, keyboard-aware Android modal with heading focus and native Back handling.

Task 6 adds `DetailsFixtureHost`, loaded only in `__DEV__` with no native-service imports or financial writes. Review supports `detail`, `conflict`, `saving`, `unresolved`; Accounts additionally supports `pending`, `linking`, `connected`, `canceled`, `failed`, `unsupported`. Account selection uses labeled checkboxes and explicit confirmation; account details/disconnect confirmation use the existing focused modal. The release bundle is checked for fixture-marker exclusion. Full TalkBack/audio, live provider acceptance, installed-session upgrade and production cutover remain Task 8/9 gates.

## F01–F18 Task 5 map

| Rows | Task 5 coverage |
|---|---|
| F01 | Consumes the Task 4 signed-in shell; native ports enforce owner access; model locked/disposal tests prevent publishing stale protected content. Full auth gates remain Task 8/9. |
| F02/F03 | Report windows/lenses, exact source/target amounts, signed currency chart lanes, daily textual alternative, coverage/freshness. Model and rendered fixture tests. |
| F04 | Server filters, paging and revision-aware annotation; offline fallback, detail labels/draft/conflict and no-replay tests. |
| F05/F06/F07 | Authoritative alert Review is Task 6; export/import/commit and import duplicate review remain Task 7. |
| F08/F09/F10 | Task 6 adds account metadata/detail, Plaid native link/selection/cancellation/outcomes, connection errors, reconnect, sync and confirmed disconnect. Fixture/native tests; live provider acceptance remains a later gate. |
| F11/F12 | Recurring currency/classification filters, pages/source states, expected monthly/yearly/subscription amounts versus posted actuals. |
| F13 | Upcoming/payment-change/list entry points and revision-safe classification; Task 6 adds full detail/history paging through the shell handoff. |
| F14 | Consumes native timezone/week-start reporting preferences; preference editing remains Task 7. |
| F15 | Review/exclusion/FX/coverage notices plus Task 6 evidence/decisions; remaining help is Task 7 and existing About. |
| F16 | Debug-only synthetic fixtures; no production demo/error fallback added. |
| F17 | Existing typed native services, shared currency metadata and server amounts/revisions; no backend calculation changes. |
| F18 | Existing local fonts/themes and scaling; capture/login/service behavior stays in its respective tasks. Full accessibility and release acceptance remain Task 8. |
