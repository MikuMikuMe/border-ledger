# Border Ledger Android probe

## Platform and role

Android phone feasibility probe for the single owner's Pixel 10 Pro. This is a debug-only companion to Border Ledger, not the full native product. The source of truth for the larger product remains the root `PRODUCT.md` and approved Android spec.

## Job to be done

Find out whether Android exposes enough metadata from real, newly posted BOC notifications to justify a future capture adapter. The owner explicitly grants notification access in Android settings, triggers a legitimate test, sees the access/listener state and field-presence/timing preview, and may export a sanitized metadata CSV through the Android document picker.

## Safety contract

- Probe package `com.lofuyu.borderledger.probe` is separate from the future `com.lofuyu.borderledger` production package.
- The listener is declared only in the debug manifest. It inspects `com.tencent.mm` notifications only; all others are rejected before extras are read. The BOC app package is not guessed.
- At most 20 metadata previews live in process memory. No title, body, sender, notification key, financial amount, account identifier, raw dump, or screenshot is retained or exported. No network, database, logging, analytics, backup, or automatic file writing.
- The export action writes only the derived metadata shown in the probe through the Android document picker. The owner chooses the document destination; the probe does not upload or claim storage ownership. Success, cancellation, and write failure are shown as text and do not crash the activity.
- The package filter is only a controlled starting point for source identification. The owner must trigger one new alert from the known BOC conversation, verify the visible source on the device, and compare the package-only row and timestamps. Conversation identity is unavailable to this probe.
- On listener reconnect, the probe inspects currently active matching notifications through the same bounded path and labels them as recovered active observations. This is not notification history or backfill; dismissed alerts remain unavailable.
- The probe cannot approve a source, parse a transaction, or count a purchase. Any future demo state must say “synthetic.”

## Screen direction

Operate mode, Material 3 top app bar and controls. Text labels make permission and listener state readable without color. Touch actions are at least 48 dp high. The probe is static, including with reduced motion or Battery Saver. System back and system document/settings flows remain native.

## Unknowns and acceptance

Installed Android and WeChat versions, actual source conversation/package, CMB channel/account, BOC export format, rich notification fields, individual message timestamp, and silent/muted delivery remain unknown until the owner tests a physical Pixel. Generic, redacted, or untimestamped results permit review/import only. Automatic capture needs approved source/type, labeled amount/currency, resolvable instrument, and original individual posting time; the probe does not claim these gates pass.

## Task 17 release boundary

The Android release is not accepted by source presence alone. Every F01–F18 row in `docs/android-validation.md` needs a reachable native flow, real service behavior, and owner-captured evidence. Full-parity owner credentials and narrow capture credentials remain separate: capture can upload only approved source/account/currency events and cannot read the ledger, manage banks, review imports, or refresh owner authority.

Offline recovery is explicit. A same-ledger owner may see an encrypted remembered snapshot only while the device is unlocked and its lease is valid; explicit logout clears visible owner data and credentials, pauses monitoring, and retains only encrypted pending same-ledger uploads plus revocation-only intents. Reconnect checks revocation before refresh or writes. Normal upgrades must preserve queued identity and original event time, while restore testing must invalidate restored grants and require re-pairing.

Backup, migration, signing, and release are gates, not claims: backup rules exclude private app state; populated synthetic/sandbox migration and restore must be rehearsed; signing material remains in owner custody/protected CI secrets; and an APK is claimable only after Gradle, `apksigner`, checksum, and Pixel install/update evidence exist. CMB remains disabled and statement-import-only until an independent source capability test exists.
