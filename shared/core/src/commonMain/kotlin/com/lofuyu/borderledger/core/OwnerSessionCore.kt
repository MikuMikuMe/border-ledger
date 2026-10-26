package com.lofuyu.borderledger.auth

import com.lofuyu.borderledger.api.OwnerCodeExchangeRequest
import com.lofuyu.borderledger.api.OwnerLoginClient
import com.lofuyu.borderledger.api.OwnerLoginStartRequest
import com.lofuyu.borderledger.api.OwnerLoginStartResponse
import com.lofuyu.borderledger.api.OwnerRefreshRequest
import com.lofuyu.borderledger.api.OwnerTokenResponse
import com.lofuyu.borderledger.api.RevocationGrantType
import com.lofuyu.borderledger.api.RevocationIntent
import com.lofuyu.borderledger.api.TransportFailure
import com.lofuyu.borderledger.local.LocalDataPolicy
import com.lofuyu.borderledger.local.SecureStorageException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.TimeoutCancellationException
import kotlin.coroutines.coroutineContext
import kotlinx.coroutines.withTimeout
import com.lofuyu.borderledger.core.CoreClock
import com.lofuyu.borderledger.core.CoreCrypto
import com.lofuyu.borderledger.core.CallbackInput
import com.lofuyu.borderledger.core.CallbackDecision
import com.lofuyu.borderledger.core.decideCallback

open class OwnerSessionCore(
    private val store: OwnerSessionStore,
    private val client: OwnerLoginClient,
    private val captureCredentials: CaptureCredentialProvider,
    private val localData: LocalDataPolicy,
    private val callbackUrl: String,
    private val environment: String,
    private val deviceId: String? = null,
    private val clock: CoreClock,
    private val crypto: CoreCrypto,
) : OwnerCredentialProvider, OwnerSessionAuthorizationHandler {
    private val mutex = Mutex()
    private val _state = MutableStateFlow<OwnerSessionState>(OwnerSessionState.Restoring)
    override val state: StateFlow<OwnerSessionState> = _state.asStateFlow()

    private var initialized = false
    private var session: OwnerSessionRecord? = null
    private var pendingLogin: PendingOwnerLogin? = null
    private var completedCallback: CompletedCallbackMarker? = null

    suspend fun restore() {
        mutex.withLock {
            if (initialized) return@withLock
            _state.value = OwnerSessionState.Restoring
            try {
                session = store.readSession()
                retireAmbiguousCredentials()
                pendingLogin = store.readPendingLogin()
                completedCallback = store.readCompletedCallback()
                restoreStoredState(store.readPendingRotation())
                initialized = true
            } catch (_: SecureStorageException) {
                _state.value = OwnerSessionState.StorageFailure(StorageOperation.Restore)
            }
        }
    }

    private suspend fun retireAmbiguousCredentials() {
        val old = session
        val capture = captureCredentials.current()
        if (old != null && old.requiresIdentityUpgrade()) {
            localData.pauseMonitoring()
            localData.clearOwnerReadCache()
            localData.queueRevocation(RevocationIntent(RevocationGrantType.OwnerFamily, old.revision, old.revocationCapability, clock.nowIso()))
            store.clearSession()
            store.clearPendingLogin()
            store.clearPendingRotation()
            session = null
        }
        if (capture != null && capture.requiresIdentityUpgrade()) {
            localData.pauseMonitoring()
            localData.queueRevocation(RevocationIntent(RevocationGrantType.CaptureCredential, capture.generation, capture.revocationCapability, clock.nowIso()))
            captureCredentials.clear()
        }
    }

    private fun OwnerSessionRecord.requiresIdentityUpgrade() = identity == null || epoch == null
    private fun CaptureCredentialRecord.requiresIdentityUpgrade() = identity == null || sessionEpoch == null

    private suspend fun restoreStoredState(pendingRotation: PendingOwnerRotation?) {
        val current = session
        when {
            current != null -> restoreExistingSession(current, pendingRotation)
            pendingLogin != null -> publishAwaitingBrowser(requireNotNull(pendingLogin))
            else -> publishSignedOut(SignedOutReason.Explicit)
        }
    }

    private suspend fun restoreExistingSession(current: OwnerSessionRecord, pendingRotation: PendingOwnerRotation?) {
        when {
            pendingRotation != null -> refreshSafely(pendingRotation)
            accessIsValid(current) -> publishSignedIn(current)
            else -> refreshSafely(null)
        }
    }

    private suspend fun refreshSafely(existing: PendingOwnerRotation?) {
        try {
            refreshLocked(existing)
        } catch (error: Throwable) {
            transitionAfterRefreshFailure(error)
        }
    }

    private fun publishAwaitingBrowser(pending: PendingOwnerLogin) {
        _state.value = OwnerSessionState.AwaitingBrowser(pending.requestId, pending.expiresAt)
    }

    suspend fun beginLogin(staySignedIn: Boolean, pendingDestination: String?): LoginLaunch {
        prepareLogin()
        mutex.withLock {
            check(session == null) { "Sign out before changing accounts." }
            localData.pauseMonitoring()
            localData.clearOwnerReadCache()
            _state.value = OwnerSessionState.SigningIn
            val stateToken = randomToken(32)
            val verifier = randomToken(48)
            val request = OwnerLoginStartRequest(
                codeChallenge = crypto.pkceChallenge(verifier),
                state = stateToken,
                deviceId = deviceId,
                environment = environment,
            )
            return try {
                val response = startLogin(request)
                val pending = buildPendingLogin(
                    PendingLoginDraft(response, stateToken, verifier, staySignedIn, pendingDestination),
                )
                store.writePendingLogin(pending)
                pendingLogin = pending
                initialized = true
                publishAwaitingBrowser(pending)
                LoginLaunch(response.requestId, response.authorizationUrl, response.expiresAt)
            } catch (error: TransportFailure) {
                val startTimedOut = (_state.value as? OwnerSessionState.SignedOut)?.reason == SignedOutReason.StartFailed
                if (!startTimedOut) {
                    _state.value = OwnerSessionState.SignedOut(reason = SignedOutReason.StartFailed)
                }
                throw error
            } catch (_: SecureStorageException) {
                _state.value = OwnerSessionState.StorageFailure(StorageOperation.Callback)
                throw SecureStorageException("Owner login state could not be protected.")
            } catch (error: Throwable) {
                _state.value = OwnerSessionState.SignedOut(reason = SignedOutReason.StartFailed)
                throw error
            }
        }
    }

    private suspend fun prepareLogin() {
        if (!initialized) restore()
        if (session != null) signOut()
    }

    private suspend fun startLogin(request: OwnerLoginStartRequest): OwnerLoginStartResponse = try {
        withTimeout(LOGIN_START_TIMEOUT_MILLIS) { client.startLogin(request) }
    } catch (_: TimeoutCancellationException) {
        _state.value = OwnerSessionState.SignedOut(reason = SignedOutReason.StartFailed)
        throw TransportFailure.Offline
    }

    private data class PendingLoginDraft(
        val response: OwnerLoginStartResponse,
        val stateToken: String,
        val verifier: String,
        val staySignedIn: Boolean,
        val pendingDestination: String?,
    )

    private fun buildPendingLogin(draft: PendingLoginDraft): PendingOwnerLogin = PendingOwnerLogin(
        requestId = draft.response.requestId,
        state = draft.stateToken,
        verifier = draft.verifier,
        idempotencyKey = randomToken(24),
        deviceId = deviceId,
        callbackUrl = callbackUrl,
        environment = environment,
        staySignedIn = draft.staySignedIn,
        expiresAt = draft.response.expiresAt,
        pendingDestination = draft.pendingDestination,
    )

    protected suspend fun handleVerifiedCallback(verify: () -> VerifiedCallback): CallbackResult {
        return mutex.withLock { handleVerifiedCallbackLocked(verify) }
    }

    private suspend fun handleVerifiedCallbackLocked(verify: () -> VerifiedCallback): CallbackResult {
        val verified = validateCallback(verify) ?: return CallbackResult.CallbackRejected
        return try {
            if (pendingLogin == null) pendingLogin = store.readPendingLogin()
            when (val decision = callbackDecision(verified)) {
                CallbackDecision.Duplicate -> CallbackResult.DuplicateIgnored
                is CallbackDecision.Rejected -> rejectCallback(decision.recoverable)
                CallbackDecision.Canceled -> completeFailedCallback(CallbackResult.Canceled, SignedOutReason.Canceled)
                CallbackDecision.FailedReturn -> completeFailedCallback(CallbackResult.FailedReturn, SignedOutReason.FailedReturn)
                CallbackDecision.Exchange -> exchangeCallback(verified)
            }
        } catch (_: SecureStorageException) {
            _state.value = OwnerSessionState.StorageFailure(StorageOperation.Callback)
            CallbackResult.StorageFailure
        }
    }

    private fun validateCallback(verify: () -> VerifiedCallback): VerifiedCallback? = try {
        verify()
    } catch (_: CallbackValidationException) {
        rejectCallback(recoverable = false)
        null
    } catch (_: IllegalArgumentException) {
        rejectCallback(recoverable = false)
        null
    }

    private suspend fun callbackDecision(verified: VerifiedCallback): CallbackDecision {
        val completed = completedState(verified)
        return decideCallback(
            CallbackInput(
                pendingState = pendingLogin?.state,
                returnedState = verified.state,
                completedState = completed,
                code = verified.code,
                error = verified.error,
            ),
        )
    }

    private suspend fun completedState(verified: VerifiedCallback): String? {
        if (pendingLogin != null) return null
        val returnedState = verified.state ?: return null
        return returnedState.takeIf { isCompletedState(it) }
    }

    private fun rejectCallback(recoverable: Boolean): CallbackResult {
        _state.value = OwnerSessionState.CallbackRejected(recoverable)
        return CallbackResult.CallbackRejected
    }

    private suspend fun completeFailedCallback(result: CallbackResult, reason: SignedOutReason): CallbackResult {
        store.clearPendingLogin()
        pendingLogin = null
        _state.value = OwnerSessionState.SignedOut(
            pendingRevocations = store.readPendingRevocations().size,
            reason = reason,
        )
        return result
    }

    private suspend fun exchangeCallback(verified: VerifiedCallback): CallbackResult {
        val pending = requireNotNull(pendingLogin)
        val code = requireNotNull(verified.code)
        _state.value = OwnerSessionState.Exchanging
        val response = try {
            client.exchangeCode(
                OwnerCodeExchangeRequest(
                    requestId = pending.requestId,
                    code = code,
                    verifier = pending.verifier,
                    state = pending.state,
                    deviceId = pending.deviceId,
                    environment = pending.environment,
                    idempotencyKey = pending.idempotencyKey,
                    staySignedIn = pending.staySignedIn,
                ),
            )
        } catch (_: TransportFailure.Unauthorized) {
            _state.value = OwnerSessionState.SignedOut(reason = SignedOutReason.UnapprovedIdentity)
            return CallbackResult.ExchangeFailed
        } catch (_: TransportFailure) {
            _state.value = OwnerSessionState.SignedOut(reason = SignedOutReason.ExchangeFailed)
            return CallbackResult.ExchangeFailed
        }
        return commitExchange(response, pending)
    }

    private suspend fun commitExchange(response: OwnerTokenResponse, pending: PendingOwnerLogin): CallbackResult = try {
        val record = response.toRecord(pending.pendingDestination, pending.deviceId, randomToken(24))
        store.writeSession(record)
        val marker = CompletedCallbackMarker(stateDigest(pending.state), clock.nowIso())
        store.writeCompletedCallback(marker)
        store.clearPendingLogin()
        session = record
        completedCallback = marker
        pendingLogin = null
        initialized = true
        publishSignedIn(record)
        CallbackResult.SignedIn
    } catch (_: SecureStorageException) {
        _state.value = OwnerSessionState.StorageFailure(StorageOperation.LoginCommit)
        CallbackResult.StorageFailure
    }

    suspend fun <T> withOwnerAuthorization(block: suspend (String) -> T): T? {
        if (!initialized) restore()
        val expected = coroutineContext[OwnerWork]?.binding ?: currentBinding() ?: return null
        return mutex.withLock {
            if (currentBinding() != expected) return@withLock null
            val current = ensureAccessLocked() ?: return@withLock null
            if (currentBinding() != expected) return@withLock null
            block(current.accessToken)
        }
    }

    /** Serializes local commits with logout and session replacement. Never hold this across HTTP. */
    override suspend fun commitIfCurrent(expected: SessionBinding, block: suspend () -> Unit): Boolean = mutex.withLock {
        if (currentBinding() != expected) return@withLock false
        block()
        true
    }

    override fun currentBinding(): SessionBinding? {
        val current = session ?: return null
        if (_state.value !is OwnerSessionState.SignedIn && _state.value !is OwnerSessionState.Refreshing) return null
        return current.identity?.let { identity -> current.epoch?.let { SessionBinding(identity, it) } }
    }

    override suspend fun accessTokenFor(expected: SessionBinding): String? = mutex.withLock {
        if (currentBinding() != expected) return@withLock null
        val current = ensureAccessLocked() ?: return@withLock null
        if (currentBinding() == expected) current.accessToken else null
    }

    override suspend fun accessToken(): String? {
        if (!initialized) restore()
        val expected = coroutineContext[OwnerWork]?.binding ?: currentBinding() ?: return null
        return accessTokenFor(expected)
    }

    override suspend fun markRemoteAuthorizationFailure() {
        mutex.withLock {
            val expected = coroutineContext[OwnerWork]?.binding
            if (expected != null && currentBinding() != expected) return@withLock
            if (_state.value !is OwnerSessionState.SignedIn && _state.value !is OwnerSessionState.Refreshing) return@withLock
            try {
                _state.value = OwnerSessionState.Expired(store.readPendingRevocations().size)
            } catch (_: SecureStorageException) {
                _state.value = OwnerSessionState.StorageFailure(StorageOperation.RefreshCommit)
            }
        }
    }

    suspend fun consumePendingDestination(): String? = mutex.withLock {
        val destination = session?.pendingDestination
        if (destination != null) {
            val updated = requireNotNull(session).copy(pendingDestination = null)
            try {
                store.writeSession(updated)
                session = updated
                publishSignedIn(updated)
            } catch (_: SecureStorageException) {
                _state.value = OwnerSessionState.StorageFailure(StorageOperation.LoginCommit)
                return@withLock null
            }
        }
        destination
    }

    suspend fun signOut() {
        if (!initialized) restore()
        mutex.withLock {
            _state.value = OwnerSessionState.SigningOut
            val context = prepareSignOut() ?: return@withLock
            if (!revokeOwner(context.current)) return@withLock
            if (!revokeCapture(context.capture)) return@withLock
            finishSignOut()
        }
    }

    private data class SignOutContext(
        val current: OwnerSessionRecord?,
        val capture: CaptureCredentialRecord?,
    )

    private suspend fun prepareSignOut(): SignOutContext? {
        val capture = try {
            captureCredentials.current()
        } catch (_: SecureStorageException) {
            publishStorageFailure()
            return null
        }
        return try {
            localData.pauseMonitoring()
            localData.clearOwnerReadCache()
            localData.retainEncryptedOutbox()
            SignOutContext(session, capture)
        } catch (_: SecureStorageException) {
            publishStorageFailure()
            null
        }
    }

    private suspend fun revokeOwner(current: OwnerSessionRecord?): Boolean {
        if (current == null) return true
        val intent = RevocationIntent(
            grantType = RevocationGrantType.OwnerFamily,
            generation = current.revision,
            capability = current.revocationCapability,
            createdAt = clock.nowIso(),
        )
        return try {
            client.logout(current.accessToken)
            true
        } catch (_: TransportFailure) {
            queueRevocationSafely(intent)
        }
    }

    private suspend fun revokeCapture(capture: CaptureCredentialRecord?): Boolean {
        if (capture == null) return true
        val intent = RevocationIntent(
            grantType = RevocationGrantType.CaptureCredential,
            generation = capture.generation,
            capability = capture.revocationCapability,
            createdAt = clock.nowIso(),
        )
        return try {
            client.revoke(intent)
            true
        } catch (_: TransportFailure.StaleRevocation) {
            true
        } catch (_: TransportFailure) {
            queueRevocationSafely(intent)
        }
    }

    private suspend fun finishSignOut() {
        try {
            store.clearSession()
            store.clearPendingLogin()
            store.clearPendingRotation()
            captureCredentials.clear()
            session = null
            pendingLogin = null
            val pending = localData.pendingRevocationCount()
            publishSignedOut(if (pending == 0) SignedOutReason.Explicit else SignedOutReason.Offline, pending)
        } catch (_: SecureStorageException) {
            publishStorageFailure()
        }
    }

    private fun publishStorageFailure() {
        _state.value = OwnerSessionState.StorageFailure(StorageOperation.Logout)
    }

    suspend fun flushPendingRevocations() {
        mutex.withLock {
            val pending = store.readPendingRevocations()
            for (intent in pending) {
                try {
                    client.revoke(intent)
                    store.writePendingRevocations(store.readPendingRevocations().filterNot { it == intent })
                } catch (_: TransportFailure.StaleRevocation) {
                    store.writePendingRevocations(store.readPendingRevocations().filterNot { it == intent })
                } catch (_: TransportFailure) {
                    break
                }
            }
            val signedOut = _state.value as? OwnerSessionState.SignedOut
            if (signedOut != null) {
                val remaining = store.readPendingRevocations().size
                when {
                    remaining > 0 -> publishSignedOut(SignedOutReason.Offline, remaining)
                    signedOut.reason == SignedOutReason.Offline || signedOut.pendingRevocations > 0 ->
                        publishSignedOut(SignedOutReason.Explicit, 0)
                }
            }
        }
    }

    private suspend fun ensureAccessLocked(): OwnerSessionRecord? {
        val current = session
        if (current == null) {
            _state.value = OwnerSessionState.SignedOut()
            return null
        }
        if (accessIsValid(current)) return current
        return try {
            refreshLocked(null)
            session
        } catch (error: Throwable) {
            transitionAfterRefreshFailure(error)
            null
        }
    }

    private suspend fun refreshLocked(existing: PendingOwnerRotation?): OwnerSessionRecord {
        val current = requireNotNull(session)
        val pending = existing ?: store.readPendingRotation() ?: run {
            val created = PendingOwnerRotation(randomToken(24), clock.nowIso())
            store.writePendingRotation(created)
            created
        }
        _state.value = OwnerSessionState.Refreshing
        val response = client.refresh(
            OwnerRefreshRequest(
                refreshToken = current.refreshToken,
                environment = environment,
                idempotencyKey = pending.idempotencyKey,
            ),
        )
        val updated = response.toRecord(current.pendingDestination, current.deviceId, requireNotNull(current.epoch))
        if (updated.identity != current.identity) throw TransportFailure.Unauthorized
        store.writeSession(updated)
        store.clearPendingRotation()
        session = updated
        publishSignedIn(updated)
        return updated
    }

    private suspend fun transitionAfterRefreshFailure(error: Throwable) {
        when (error) {
            is SecureStorageException -> _state.value = OwnerSessionState.StorageFailure(StorageOperation.RefreshCommit)
            else -> _state.value = OwnerSessionState.Expired(store.readPendingRevocations().size)
        }
    }

    private suspend fun queueRevocationSafely(intent: RevocationIntent): Boolean = try {
        localData.queueRevocation(intent)
        true
    } catch (_: SecureStorageException) {
        _state.value = OwnerSessionState.StorageFailure(StorageOperation.Logout)
        false
    }

    private fun publishSignedIn(value: OwnerSessionRecord) {
        _state.value = OwnerSessionState.SignedIn(value.expiresAt, value.scopes, value.pendingDestination, binding = SessionBinding(requireNotNull(value.identity), requireNotNull(value.epoch)))
    }

    private suspend fun publishSignedOut(reason: SignedOutReason, pendingOverride: Int? = null) {
        val pending = pendingOverride ?: store.readPendingRevocations().size
        _state.value = OwnerSessionState.SignedOut(pending, reason)
    }

    private fun accessIsValid(value: OwnerSessionRecord): Boolean = value.identity != null && value.epoch != null && com.lofuyu.borderledger.core.accessIsValid(value.expiresAt, clock)

    private suspend fun isCompletedState(value: String): Boolean {
        val marker = completedCallback ?: store.readCompletedCallback()
        return marker?.stateDigest == stateDigest(value)
    }

    private fun stateDigest(value: String): String = crypto.sha256Hex(value)

    private fun randomToken(bytes: Int): String = crypto.randomToken(bytes)

    private companion object {
        const val LOGIN_START_TIMEOUT_MILLIS = 15_000L



        fun OwnerTokenResponse.toRecord(destination: String?, deviceId: String?, epoch: String): OwnerSessionRecord = OwnerSessionRecord(
            accessToken = accessToken,
            refreshToken = refreshToken,
            expiresAt = expiresAt,
            scopes = scopes,
            revision = revision,
            revocationCapability = revocationCapability,
            deviceId = deviceId,
            pendingDestination = destination,
            identity = LedgerIdentity(requireNotNull(userId), requireNotNull(ledgerId)),
            epoch = epoch,
        )

    }
}
