package com.lofuyu.borderledger.debug

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import com.lofuyu.borderledger.ui.ledger.FxReportPreviewScreen
import com.lofuyu.borderledger.ui.theme.AppearanceMode
import com.lofuyu.borderledger.ui.theme.BorderLedgerTheme

/** Debug-only, credential-free report fixture entry point for QA. */
class FxReportPreviewActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val scenario = FxReportPreviewCase.fromIntentValue(intent.getStringExtra(EXTRA_SCENARIO)).intentValue
        setContent {
            BorderLedgerTheme(mode = AppearanceMode.System) {
                FxReportPreviewScreen(scenario)
            }
        }
    }

    companion object {
        const val ACTION = "com.lofuyu.borderledger.debug.FX_REPORT_PREVIEW"
        const val EXTRA_SCENARIO = "scenario"
    }
}
