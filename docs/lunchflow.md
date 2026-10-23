# Lunch Flow (private owner feed)

Border Ledger can synchronize the owner's Lunch Flow Personal API feed alongside Plaid. The website and Android app use the same Worker service and ledger; no Lunch Flow key is sent to either client.

## Provider setup

1. Connect the desired bank in Lunch Flow and complete the bank's authorization there.
2. Create a REST API destination named Border Ledger.
3. Enable only the bank accounts this ledger should access in that destination.
4. Install its key as the production Worker secret `LUNCHFLOW_API_KEY`. Never use a `VITE_` variable, commit it, or paste it into an app setting.
5. In Border Ledger Accounts, load Lunch Flow accounts, select accounts and confirm their primary currency and account kind, then save the selection.

The Personal API credential belongs to one owner. This is not the Lunch Flow Platform API and must not be reused to connect unrelated users' financial accounts.

## Sync behavior

Manual refresh queues a sync of the selected accounts. The existing daily Worker cron also schedules Lunch Flow sync. Clients check queued completion through the local sync-status endpoint, which reads D1 without repeatedly contacting Lunch Flow. This reads the data available in Lunch Flow; it does not force RBC to publish new transactions or bypass bank MFA. Manage/reconnect the bank connection in Lunch Flow when required.

Transaction identities include the provider account and exact provider transaction ID. Replaying a snapshot does not create another row. Pending records remain provisional; posted history is retained when it falls outside the provider's history window. Provider failures preserve the last successful data and remain visible as sync errors.

Imported Lunch Flow accounts are dedicated accounts. The integration does not automatically merge statement/Plaid accounts or deduplicate across different sources based on matching dates and amounts. Avoid counting overlapping accounts twice when combining historical imports.

Deselecting an account stops future sync and preserves its imported history. The connection chooser includes selected/current provider accounts and up to 100 recent mappings; older disabled mappings remain in the ledger even when omitted from this chooser. Revoke access in the Lunch Flow destination to stop the credential from reading an account at the provider.

## Verification checklist

- Confirm accounts are active and the Personal API returns nonempty transactions, not merely a successful bank login.
- Compare count, date range, currency, debit/credit signs, and recent posted transactions against the bank.
- Save selection from each client and confirm the other client sees the same accounts and sync state.
- Repeat refresh; counts must remain unchanged for an unchanged provider snapshot.
- Test provider failure and reconnect behavior; last-successful data must remain readable.
- Historical depth and refresh frequency depend on the provider/bank. Statement import remains available for older history.

Lunch Flow's normalized transaction endpoint does not provide authoritative subscription contracts. Existing Plaid recurring data remains separate; no Lunch Flow subscription detection is claimed by this integration.
