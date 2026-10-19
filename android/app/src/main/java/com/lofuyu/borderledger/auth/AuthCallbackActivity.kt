package com.lofuyu.borderledger.auth

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import com.lofuyu.borderledger.BorderLedgerApplication
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/** Receives only the verified HTTPS App Link and hands it to the state-bound manager. */
class AuthCallbackActivity : Activity() {
    private val activityScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handle(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    private fun handle(intent: Intent) {
        val uri = intent.data
        if (uri == null) {
            finish()
            return
        }
        activityScope.launch {
            finishAfterAuthCallback(
                handleCallback = {
                    val manager = (application as BorderLedgerApplication).container.ownerSessionManager
                    manager.handleCallback(uri)
                },
                finish = ::finish,
            )
        }
    }

    override fun onDestroy() {
        activityScope.cancel()
        super.onDestroy()
    }
}

internal suspend fun finishAfterAuthCallback(handleCallback: suspend () -> Unit, finish: () -> Unit) {
    try {
        handleCallback()
    } catch (canceled: CancellationException) {
        throw canceled
    } catch (_: Exception) {
        // Callback inputs and exception messages may contain credentials; never expose them.
    } finally {
        finish()
    }
}
