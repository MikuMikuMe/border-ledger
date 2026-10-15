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

/**
 * Activity-bound bridge for the official Plaid Link SDK.
 *
 * The launcher is registered during Activity creation so Android can redeliver
 * an OAuth result after Activity/process recreation. A Link session is
 * single-use and is preloaded before the Activity Result contract opens it.
 * Only the short-lived public token crosses back to the coordinator; provider
 * access tokens remain on the Worker.
 */
class OfficialPlaidLinkLauncher(
    private val activity: ComponentActivity,
    private val onOrphanedResult: (PlaidLinkResult) -> Unit = {},
) : PlaidLinkLauncher {
    private var pendingResult: CompletableDeferred<PlaidLinkResult>? = null

    private val openLink: ActivityResultLauncher<PlaidSession> =
        activity.registerForActivityResult(OpenPlaidLink()) { result ->
            val mapped = mapResult(result)
            val pending = pendingResult
            if (pending == null) {
                // ActivityResult re-delivery after process recreation has no
                // in-memory waiter. Let the new Activity resume the guarded
                // server exchange rather than dropping a valid Link result.
                onOrphanedResult(mapped)
            } else {
                pendingResult = null
                pending.complete(mapped)
            }
        }

    override suspend fun launch(linkToken: String): PlaidLinkResult = withContext(Dispatchers.Main.immediate) {
        check(pendingResult == null) { "A Plaid Link session is already open." }

        val loaded = CompletableDeferred<Unit>()
        val session = Plaid.createPlaidLinkSession(
            activity,
            linkTokenConfiguration {
                token = linkToken
                onLoad = OnLoadCallback { loaded.complete(Unit) }
            },
        )
        val preloaded = withTimeoutOrNull(PRELOAD_TIMEOUT_MILLIS) { loaded.await() }
        if (preloaded == null) {
            return@withContext PlaidLinkResult.Failed("Plaid Link did not finish loading. Try again when online.")
        }

        val result = CompletableDeferred<PlaidLinkResult>()
        pendingResult = result
        try {
            openLink.launch(session)
            result.await()
        } catch (cancellation: CancellationException) {
            // Keep the sink until the external Activity returns. Clearing it
            // here would let a late result complete a newer attempt.
            throw cancellation
        } catch (error: Exception) {
            // launch() failed before Plaid owned the external Activity.
            if (pendingResult === result) pendingResult = null
            throw error
        } finally {
            if (result.isCompleted && pendingResult === result) pendingResult = null
        }
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
