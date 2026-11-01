# Actual Budget tracking and rollover implementation

Goal: Extend existing web/Android Budget with independent tracking forecasts and dated envelope rollover policies. Approved user plan in chat is the binding spec.

## Constraints
Existing budgets default envelope/carry_all. Preserve allocations, targets, funding, currency and BYOK expense semantics. Tracking forecasts never fund cash. Confirmed source records only; original currency plus dated FX. Tenant isolation and existing auth scopes. D:-based Android tools; no private data/local config committed.

## Tasks
1. Backend/domain: additive migration, tracking plans/settings/policies with revisions and retry safety, envelope chronological projection, separate tracking income/activity summary and API/contract tests. Own worker/, src/domain/ budget modules, backend tests, contracts.
2. Web: existing Budget mode switch, compact category editors, tracking plan editing and copy preview, rollover preview and save; tests, responsive styles. Own src/components/ and src/styles.css.
3. Android: mode-aware native bridge + decoders, current Budget screen integration, tracking/copy/rollover editors and accessibility; tests. Own mobile/, android/.
4. Review and QA: independent code/design review; web rendered phone/desktop; emulator local-backend save/reload and Back/large-text/dark checks; full suite/build/typechecks/Android tests/lint/build; CodeScene all changed supported source files, safeguard and origin/main change set; commit/push PR and required CI.

## Contract decisions
BudgetMode envelope|tracking. Saved preferred mode is UI preference; omitted API query mode always envelope. New clients read preference and send explicit mode. Invalid mode 400. Extend NativeBudget with typed mode-view/copy/rollover request objects, retaining legacy readView(month) and startWrite. The BudgetService facade keeps month/mode arguments for screen controllers.
RolloverPolicy carry_all|carry_positive|reset, effective outgoing month, latest <= month wins; default carry_all. close=opening+assigned+activity; next=close|max(0,close)|0. Unknown activity propagates until reset (explicit reset opens next at 0), never treat unknown cash as known. Current cash funding computed from actual balances and positive reservations; no synthetic funds.
Tracking plans independent ledger/month/direction/category, direction income|expense, safe nonnegative integer amounts. Actual savings income-expenses-fees+refunds; transfers/provisional/superseded excluded. Missing FX nulls affected metric and derived savings, planned stays available. Income separate from legacy expense-only activity. No tracking carryover.
Mode preference, tracking plans, rollover writes revision guarded with operation IDs for exact retry. Copy previous month previews and atomically replaces tracking plans only with expected destination/source revisions; no envelope overwrite.
Historical rollover preview returns changed category opening/closing for edited outgoing month and subsequent months through max(current month,last existing allocation), with same guarded revision used at commit. Category strings follow existing normalization; no rename/archive feature added.
Old clients preserve new settings fields. BYOK remains envelope-backed, no new forecast sharing.
