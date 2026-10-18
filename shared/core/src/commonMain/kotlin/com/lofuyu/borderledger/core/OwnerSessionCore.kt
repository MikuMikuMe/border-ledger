package com.lofuyu.borderledger.auth

import com.lofuyu.borderledger.api.OwnerCodeExchangeRequest
import com.lofuyu.borderledger.api.OwnerLoginClient
import com.lofuyu.borderledger.api.OwnerLoginStartRequest
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
import kotlinx.coroutines.withTimeout
import com.lofuyu.borderledger.core.CoreClock
import com.lofuyu.borderledger.core.CoreCrypto
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
                pendingLogin = store.readPendingLogin()
                completedCallback = store.readCompletedCallback()
                val pendingRotation = store.readPendingRotation()
                val current = session
                if (current != null && pendingRotation != null) {
                    try {
                        refreshLocked(pendingRotation)
                    } catch (error: Throwable) {
                        transitionAfterRefreshFailure(error)
                    }
                } else if (current != null && accessIsValid(current)) {
                    publishSignedIn(current)
                } else if (current != null) {
                    try {
                        refreshLocked(null)
                    } catch (error: Throwable) {
                        transitionAfterRefreshFailure(error)
                    }
                } else if (pendingLogin != null) {
                    val pending = requireNotNull(pendingLogin)
                    _state.value = OwnerSessionState.AwaitingBrowser(pending.requestId, pending.expiresAt)
                } else {
                    publishSignedOut(SignedOutReason.Explicit)
                }
                initialized = true
            } catch (_: SecureStorageException) {
                _state.value = OwnerSessionState.StorageFailure(StorageOperation.Restore)
            }
        }
    }

    suspend fun beginLogin(staySignedIn: Boolean, pendingDestination: String?): LoginLaunch {
        mutex.withLock {
            _state.value = OwnerSessionState.SigningIn
            val stateToken = randomToken(32)
            val verifier = randomToken(48)
            val challenge = crypto.pkceChallenge(verifier)
            val idempotencyKey = randomToken(24)
            return try {
                val response = try {
                    withTimeout(LOGIN_START_TIMEOUT_MILLIS) {
                        client.startLogin(
                            OwnerLoginStartRequest(
                                codeChallenge = challenge,
                                state = stateToken,
                                deviceId = deviceId,
                                environment = environment,
                            ),
                        )
                    }
                } catch (_: TimeoutCancellationException) {
                    _state.value = OwnerSessionState.SignedOut(reason = SignedOutReason.StartFailed)
                    throw TransportFailure.Offline
                }
                val pending = PendingOwnerLogin(
                    requestId = response.requestId,
                    state = stateToken,
                    verifier = verifier,
                    idempotencyKey = idempotencyKey,
                    deviceId = deviceId,
                    callbackUrl = callbackUrl,
                    environment = environment,
                    staySignedIn = staySignedIn,
                    expiresAt = response.expiresAt,
                    pendingDestination = pendingDestination,
                )
                store.writePendingLogin(pending)
                pendingLogin = pending
                initialized = true
                _state.value = OwnerSessionState.AwaitingBrowser(response.requestId, response.expiresAt)
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

    protected suspend fun handleVerifiedCallback(verify: () -> VerifiedCallback): CallbackResult {
        return mutex.withLock {
            val verified = try {
                verify()
            } catch (_: CallbackValidationException) {
                _state.value = OwnerSessionState.CallbackRejected(recoverable = false)
                return@withLock CallbackResult.CallbackRejected
            }
            try {
                if (pendingLogin == null) pendingLogin = store.readPendingLogin()
                val completed = if (pendingLogin == null && verified.state != null && isCompletedState(verified.state)) verified.state else null
                val decision = decideCallback(pendingLogin?.state, verified.state, completed, verified.code, verified.error)
                if (decision == CallbackDecision.Duplicate) return@withLock CallbackResult.DuplicateIgnored
                if (decision is CallbackDecision.Rejected) {
                    _state.value = OwnerSessionState.CallbackRejected(recoverable = decision.recoverable)
                    return@withLock CallbackResult.CallbackRejected
                }
                if (decision == CallbackDecision.Canceled || decision == CallbackDecision.FailedReturn) {
                    store.clearPendingLogin()
                    pendingLogin = null
                    val result = if (decision == CallbackDecision.Canceled) CallbackResult.Canceled else CallbackResult.FailedReturn
                    _state.value = OwnerSessionState.SignedOut(
                        pendingRevocations = store.readPendingRevocations().size,
                        reason = if (result == CallbackResult.Canceled) SignedOutReason.Canceled else SignedOutReason.FailedReturn,
                    )
                    return@withLock result
                }
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
                    return@withLock CallbackResult.ExchangeFailed
                } catch (_: TransportFailure) {
                    _state.value = OwnerSessionState.SignedOut(reason = SignedOutReason.ExchangeFailed)
                    return@withLock CallbackResult.ExchangeFailed
                }
                try {
                    val record = response.toRecord(pending.pendingDestination, pending.deviceId)
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
            } catch (_: SecureStorageException) {
                _state.value = OwnerSessionState.StorageFailure(StorageOperation.Callback)
                CallbackResult.StorageFailure
            }
        }
    }

    suspend fun <T> withOwnerAuthorization(block: suspend (String) -> T): T? {
        if (!initialized) restore()
        return mutex.withLock {
            val current = ensureAccessLocked() ?: return@withLock null
            block(current.accessToken)
        }
    }

    override suspend fun accessToken(): String? {
        if (!initialized) restore()
        return mutex.withLock { ensureAccessLocked()?.accessToken }
    }

    override suspend fun markRemoteAuthorizationFailure() {
        mutex.withLock {
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
            val current = session
            val capture = try {
                captureCredentials.current()
            } catch (_: SecureStorageException) {
                _state.value = OwnerSessionState.StorageFailure(StorageOperation.Logout)
                return@withLock
            }
            try {
                localData.pauseMonitoring()
                localData.clearOwnerReadCache()
                localData.retainEncryptedOutbox()
            } catch (_: SecureStorageException) {
                _state.value = OwnerSessionState.StorageFailure(StorageOperation.Logout)
                return@withLock
            }

            if (current != null) {
                val ownerIntent = RevocationIntent(
                    grantType = RevocationGrantType.OwnerFamily,
                    generation = current.revision,
                    capability = current.revocationCapability,
                    createdAt = clock.nowIso(),
                )
                try {
                    client.logout(current.accessToken)
                } catch (_: TransportFailure) {
                    if (!queueRevocationSafely(ownerIntent)) return@withLock
                }
            }
            if (capture != null) {
                val captureIntent = RevocationIntent(
                    grantType = RevocationGrantType.CaptureCredential,
                    generation = capture.generation,
                    capability = capture.revocationCapability,
                    createdAt = clock.nowIso(),
                )
                try {
                    client.revoke(captureIntent)
                } catch (_: TransportFailure.StaleRevocation) {
                    // The Worker rejected an old generation; it cannot revoke a newer grant.
                } catch (_: TransportFailure) {
                    if (!queueRevocationSafely(captureIntent)) return@withLock
                }
            }
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
                _state.value = OwnerSessionState.StorageFailure(StorageOperation.Logout)
            }
        }
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
        val updated = response.toRecord(current.pendingDestination, current.deviceId)
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
        _state.value = OwnerSessionState.SignedIn(value.expiresAt, value.scopes, value.pendingDestination)
    }

    private suspend fun publishSignedOut(reason: SignedOutReason, pendingOverride: Int? = null) {
        val pending = pendingOverride ?: store.readPendingRevocations().size
        _state.value = OwnerSessionState.SignedOut(pending, reason)
    }

    private fun accessIsValid(value: OwnerSessionRecord): Boolean = com.lofuyu.borderledger.core.accessIsValid(value.expiresAt, clock)

    private suspend fun isCompletedState(value: String): Boolean {
        val marker = completedCallback ?: store.readCompletedCallback()
        return marker?.stateDigest == stateDigest(value)
    }

    private fun stateDigest(value: String): String = crypto.sha256Hex(value)

    private fun randomToken(bytes: Int): String = crypto.randomToken(bytes)

    private companion object {
        const val LOGIN_START_TIMEOUT_MILLIS = 15_000L



        fun OwnerTokenResponse.toRecord(destination: String?, deviceId: String?): OwnerSessionRecord = OwnerSessionRecord(
            accessToken = accessToken,
            refreshToken = refreshToken,
            expiresAt = expiresAt,
            scopes = scopes,
            revision = revision,
            revocationCapability = revocationCapability,
            deviceId = deviceId,
            pendingDestination = destination,
        )

    }
}
