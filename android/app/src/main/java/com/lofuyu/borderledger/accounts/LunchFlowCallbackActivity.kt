package com.lofuyu.borderledger.accounts

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import com.lofuyu.borderledger.BorderLedgerApplication
import kotlinx.coroutines.launch

/** Separate from native sign-in. The application scope survives Activity destruction. */
class LunchFlowCallbackActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) { super.onCreate(savedInstanceState); handle(intent) }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); handle(intent) }
    private fun handle(intent: Intent) {
        val value=intent.dataString
        val runtime=(application as BorderLedgerApplication).nativeServices
        if(value!=null)runtime.scope.launch {
            try {
                LunchFlowLinks(com.lofuyu.borderledger.BuildConfig.MOBILE_API_ORIGIN).callback(value)
                runtime.container.ownerSessionManager.restore()
                val owner=runtime.currentGeneration()
                if(owner!=null)runtime.withOwner(owner) { runtime.lunchFlow.callback(value); runtime.lunchFlowChanges.emit(Unit) }
            }catch(_: Exception){ /* Never expose callback input or exception contents. */ }
        }
        finish()
    }
}
