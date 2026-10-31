# Recurring planning and currency reporting design

## Goal
Allow a ledger owner to plan recurring bills and income across web and Android, including transactions imported through Lunch Flow or statements, and distinguish expected, matched and possibly missing occurrences. Preserve the existing currency-aware reporting and its conversion provenance.

## Design
Add ledger-owned recurring plans independent of provider streams. A plan records account, currency, payee match, direction, expected amount, cadence, start date and an optional end date. The owner creates, edits and disables plans; changes must be revision-checked. Match only same-ledger, same-account, same-currency transactions of the right kind against an explicit payee rule, amount and a bounded date window. Present ambiguous matches for review; never silently change a transaction or create one. Confirmed and provisional matches remain distinct. A past occurrence without a confirmed match is labelled potentially missing, with sync freshness and pending status clearly shown. Occurrences are projections, not financial ledger entries.

Provide upcoming and potentially missing occurrences, transaction match details and management in web and Android. All server queries enforce ledger ownership. Limit work and result size, calculate calendar recurrences deterministically including month-end and timezones, and handle sync latency, duplicates, refunds and transfers conservatively. Keep Plaid recurring streams and classifications intact and visibly identified as provider estimates. Existing FX source totals, historical rate dates and incomplete-conversion warnings remain authoritative. Where useful expose reporting-currency estimates for planning, never blend currencies without rates or present estimates as actual costs.

Future BYOK AI can consume explicit read-only, ledger-scoped summaries through a separate opt-in boundary. This change creates no AI credentials, data transmission, model dependency or speculative provider abstraction.

## Verification
Tests cover tenant isolation, reconciliation, duplicate/ambiguous and provisional matches, stale feeds, calendar edges, currency precision, FX gaps, pagination and both clients. Run repository gates, applicable Android tests, CodeScene and visual checks before a PR. Do not deploy production or expose real financial data in fixtures.

## Resolved contracts
- Plans use a positive integer minor-unit amount and an explicit expense or income direction. Account and currency must be an allowed account-currency pair. Initial matching uses normalized exact merchant text and exact amount; the owner selects the account and merchant. No fuzzy matching or automatic mutation of transactions.
- Initial schedules support weekly, biweekly, monthly and yearly. Monthly and yearly dates clamp to the final calendar day when the anchor day does not exist, without shifting the original anchor. Start and end are inclusive. Dates use the ledger's reporting timezone.
- An occurrence is identified by ledger, plan and scheduled date. A transaction can satisfy at most one occurrence. Multiple eligible candidates or overlapping plans are ambiguous and must not be auto-confirmed. A provisional candidate is pending; confirmed candidates use the ledger's reconciled transaction identity. Re-evaluate after corrections and reconciliation.
- The date match window is seven days before through seven days after the scheduled date. A missing indication requires the window to have passed, no candidate, and a successful, error-free provider sync after the end of the window. Imported-only, disconnected, stale or error accounts are not assessable, not missing. Excluded transfers, refunds and needs-review records are not confirmed matches.
- Limit plan creation and query windows to bounded values, enforce ledger-scoped access and revision conflicts, and make create requests idempotent. A separate mobile capability and API contract must be implemented across the Worker, Android bridge and React Native client.
- Forecast totals remain in source currencies; historical conversion continues using the existing accounting-date FX snapshots. Future AI access requires explicit consent and a separately designed redaction and credential policy.

### Lunch Flow rollout

Apply migration 0028 before deploying the Worker. Queue messages created by the previous Worker have no tracking identifier and are acknowledged without publishing a snapshot by the new Worker. Drain the existing Lunch Flow queue before deployment when possible; otherwise request a fresh sync after deployment. Missing-payment assessment remains unavailable for a Lunch Flow mapping until a tracked snapshot completes successfully. A failed or in-flight sync never counts as proof that a payment is missing.
