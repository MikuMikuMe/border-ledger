# Native service contracts

The eight `Native*.ts` files are the public service API for RN screens. Android
implements the generated `com.lofuyu.borderledger.react.codegen.*Spec` classes;
`NativeServicePackage` is explicitly registered in debug builds only. The production
Compose launcher and native services remain in place.

Subscribe to typed events, then request the initial snapshot (or initial page).
Call `NativeSession.refreshOnResume()` when the JS app resumes; the Android host
also refreshes native session state on resume. Ledger/recurring/review events
invalidate reads. Capture, account, preference and file events contain safe state.
Use native decimal-string minor-unit amounts directly; never round-trip through
JavaScript `Number`. Date-only domain fields stay `YYYY-MM-DD`; timestamps are ISO.

Every write takes a stable caller-generated opaque operation ID (8–96 ASCII
letters/digits/underscore/hyphen). Keep the ID until its outcome is known. Query or
cancel through `NativeSession`. On a new JS runtime, call `readOperations(0, 50)`
(and subsequent offset pages) to discover native operation IDs and outcomes without
JS persistence. Repeating the ID returns its native durable status;
a different ID cannot retry an identical unresolved write either. Statuses are
`awaiting_result`, `running`, `completed`, `canceled`, `revision_conflict`, `failed_local`, and
`reconciliation_required`. `completed` means the existing native repository returned
its confirmed outcome. `resultId` is a safe receipt, preview or backend-operation
reference; file snapshots distinguish actual import/export receipt IDs. Cancel
can discard an unsubmitted external result. It cannot undo a submitted write.

`failed_local` is terminal and carries no receipt: native validation or document
parsing proved that the operation sent no backend request. It permits a deliberate
new reviewed action. Unknown failures after preview/staging/commit submission remain
`reconciliation_required`; neither snapshots nor an error message can reclassify them.
Import commits accept 1–500 selected rows. Capture exposes separate listener-access
and app-posting notification settings actions; both remain native host intents.

After a lost response, an existing read endpoint may help a screen explain the
current state, but the bridge never infers that a particular write succeeded.
`reconciliation_required` is deliberately persistent where the existing backend
has no operation-status endpoint. It must not trigger an automatic retry. File
picker/Plaid operation identities survive process death; claimed callbacks are
never resubmitted. Native import row review is paginated. A staged import draft
is retained across Activity recreation in the application, but is not reconstructed
after process death; its safe operation/preview identifiers remain queryable.

Native browser URLs, PKCE, credentials, provider tokens, SAF URIs and file/export
payloads are never module arguments, return values, events or JS storage. Exceptions
are mapped to fixed codes/messages without attaching the native Throwable.

Payload aliases are intentionally inline in each Codegen spec: RN 0.87's installed
parser does not resolve imported aliases for these payloads. `BridgeTypes.ts` is
available for consumer-only type imports. Run mobile `npm run typecheck` and Android
`:app:generateCodegenArtifactsFromSchema :app:compileDebugKotlin` after changes.
