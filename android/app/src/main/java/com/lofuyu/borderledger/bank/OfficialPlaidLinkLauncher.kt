package com.lofuyu.borderledger.bank

import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import com.plaid.link.OpenPlaidLink
import com.plaid.link.OnLoadCallback
import com.plaid.link.Plaid
import com.plaid.link.PlaidSession
import com.plaid.link.configuration.linkTokenConfiguration
import com.plaid.link.result.LinkExit
import com.plaid.link.result.LinkResult
import com.plaid.link.result.LinkSuccess
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.withContext

@JvmInline
internal value class PlaidOperationId(val value: String)

@JvmInline
internal value class PlaidLinkToken(val value: String)

internal data class PlaidLaunchRequest(
    val token: PlaidLinkToken,
    val operationId: PlaidOperationId?,
    val onProviderLaunchStarted: suspend () -> Unit = {},
)

internal data class PlaidCallbackHandlers(
    val onOrphanedResult: (PlaidLinkResult, PlaidOperationId?) -> Unit = { _, _ -> },
    val onResultReceived: (PlaidOperationId?) -> Unit = {},
)

/**
 * Activity-scoped callback identity that survives Android state restoration.
 *
 * An orphaned Activity Result is accepted only when the recreated Activity
 * restored the exact operation that launched Plaid. A missing or mismatched
 * identity is deliberately rejected instead of consulting whichever bridge
 * operation happens to be pending now.
 */
internal class PlaidCallbackIdentity(restoredOperationId: PlaidOperationId? = null) {
    private var operationId: PlaidOperationId? = restoredOperationId

    fun begin(id: PlaidOperationId) {
        check(operationId == null || operationId == id) { "A different Plaid operation is already active." }
        operationId = id
    }

    fun snapshot(): PlaidOperationId? = operationId

    fun claim(adapterOperationId: PlaidOperationId?): PlaidOperationId? {
        val expected = operationId ?: return null
        if (adapterOperationId != null && adapterOperationId != expected) return null
        operationId = null
        return expected
    }

    fun complete(id: PlaidOperationId) {
        if (operationId == id) operationId = null
    }
}

/**
 * Activity-bound bridge for the official Plaid Link SDK.
 *
 * The launcher is registered during Activity creation so Android can redeliver
 * an OAuth result after Activity/process recreation. A Link session is
 * single-use and is preloaded before the Activity Result contract opens it.
 * Only the short-lived public token crosses back to the coordinator; provider
 * access tokens remain on the Worker.
 */
class OfficialPlaidLinkLauncher internal constructor(
    private val activity: ComponentActivity,
    private val callbacks: PlaidCallbackHandlers = PlaidCallbackHandlers(),
) : PlaidLinkLauncher {
    private var pendingResult: CompletableDeferred<PlaidLinkResult>? = null
    private var pendingOperationId: PlaidOperationId? = null

    private val openLink: ActivityResultLauncher<PlaidSession> =
        activity.registerForActivityResult(OpenPlaidLink()) { result ->
            val mapped = mapResult(result)
            // Mark the callback synchronously before Activity resume can expose
            // a stale cancellation action to the UI.
            callbacks.onResultReceived(pendingOperationId)
            val pending = pendingResult
            if (pending == null) {
                // ActivityResult re-delivery after process recreation has no
                // in-memory waiter. Let the new Activity resume the guarded
                // server exchange rather than dropping a valid Link result.
                callbacks.onOrphanedResult(mapped, pendingOperationId)
            } else {
                pendingResult = null
                pending.complete(mapped)
            }
        }

    override suspend fun launch(linkToken: String): PlaidLinkResult = withContext(Dispatchers.Main.immediate) {
        launchInternal(PlaidLaunchRequest(PlaidLinkToken(linkToken), pendingOperationId))
    }

    /** RN supplies the persisted native operation ID so a callback cannot be rebound to a newer flow. */
    internal suspend fun launch(request: PlaidLaunchRequest): PlaidLinkResult = withContext(Dispatchers.Main.immediate) {
        launchInternal(request)
    }

    private suspend fun launchInternal(request: PlaidLaunchRequest): PlaidLinkResult {
        check(pendingResult == null) { "A Plaid Link session is already open." }
        pendingOperationId = request.operationId

        val session = preloadSession(request.token)
        if (session == null) {
            pendingOperationId = null
            return PlaidLinkResult.Failed("Plaid Link did not finish loading. Try again when online.")
        }

        return awaitSession(session, request.onProviderLaunchStarted)
    }

    private suspend fun awaitSession(
        session: PlaidSession,
        onProviderLaunchStarted: suspend () -> Unit,
    ): PlaidLinkResult {
        val result = CompletableDeferred<PlaidLinkResult>()
        pendingResult = result
        return try {
            onProviderLaunchStarted()
            openLink.launch(session)
            result.await()
        } catch (cancellation: CancellationException) {
            // Keep the sink until the external Activity returns. Clearing it
            // here would let a late result complete a newer attempt.
            throw cancellation
        } catch (error: Exception) {
            // launch() failed before Plaid owned the external Activity.
            if (pendingResult === result) {
                pendingResult = null
                pendingOperationId = null
            }
            throw error
        } finally {
            if (result.isCompleted && pendingResult === result) {
                pendingResult = null
                pendingOperationId = null
            }
        }
    }

    private suspend fun preloadSession(linkToken: PlaidLinkToken): PlaidSession? {
        val loaded = CompletableDeferred<Unit>()
        val session = Plaid.createPlaidLinkSession(
            activity,
            linkTokenConfiguration {
                token = linkToken.value
                onLoad = OnLoadCallback { loaded.complete(Unit) }
            },
        )
        return withTimeoutOrNull(PRELOAD_TIMEOUT_MILLIS) { loaded.await() }?.let { session }
    }

    /** A recreated RN Activity receives orphaned results through the persisted native operation. */
    fun releaseActivityWaiter() {
        pendingResult?.cancel(CancellationException("Activity detached"))
        pendingResult = null
        // Keep pendingOperationId for a possible redelivered callback after recreation.
    }

    private fun mapResult(result: LinkResult): PlaidLinkResult = when (result) {
        is LinkSuccess -> result.publicToken
            .takeIf { it.isNotBlank() }
            ?.let(PlaidLinkResult::Success)
            ?: PlaidLinkResult.Failed("Plaid Link completed without a public token.")

        is LinkExit -> result.error?.let { error ->
            PlaidLinkResult.Failed(
                error.displayMessage?.takeIf { it.isNotBlank() }
                    ?: error.errorMessage.takeIf { it.isNotBlank() }
                    ?: "Plaid Link exited with an error.",
            )
        } ?: PlaidLinkResult.Canceled
    }

    private companion object {
        const val PRELOAD_TIMEOUT_MILLIS = 60_000L
    }
}
