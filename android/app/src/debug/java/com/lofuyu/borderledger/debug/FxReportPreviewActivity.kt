package com.lofuyu.borderledger.debug

import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import com.lofuyu.borderledger.ui.ledger.LedgerReport
import com.lofuyu.borderledger.ui.ledger.formatMinorUnits

/** Debug-only, credential-free report fixture entry point for QA. */
class FxReportPreviewActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val case = FxReportPreviewCase.fromIntentValue(intent.getStringExtra(EXTRA_SCENARIO))
        val report = FxReportPreviewFixture.report(case)
        val provisional = case == FxReportPreviewCase.PROVISIONAL
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(20.dp(), 20.dp(), 20.dp(), 20.dp())
            setBackgroundColor(0xFFF3EFE6.toInt())
        }

        content.addText("FX report preview · ${case.intentValue}", heading = true)
        content.addText("Debug fixture only. No owner credential, network request, or Frankfurter call is used.")
        content.addText("Total spending in ${report.reportingCurrency ?: "source currencies"}", heading = true)
        val totals = report.convertedTotals
        if (totals == null) {
            content.addText("No converted total is available for this fixture.")
        } else {
            val amount = if (provisional) totals.confirmedMinorUnits + totals.provisionalMinorUnits else totals.confirmedMinorUnits
            content.addText(formatMinorUnits(amount, report.reportingCurrency ?: "CAD"))
            content.addText(if (report.fx.complete) "Locked to purchase dates using Frankfurter daily rates." else "Partial conversion; source audit remains available.")
        }
        if (!report.fx.complete) content.addText("Unavailable source currencies: ${report.fx.unavailableSourceCurrencies.joinToString()}")
        content.addText("Converted daily totals", heading = true)
        report.convertedDailyTotals.forEach { daily ->
            val amount = if (provisional) daily.confirmedMinorUnits + daily.provisionalMinorUnits else daily.confirmedMinorUnits
            content.addText("${daily.date} · ${report.reportingCurrency}: ${formatMinorUnits(amount, report.reportingCurrency ?: "CAD")}")
        }
        report.fx.chineseBankBand?.let { content.addText("Chinese bank band fixture: $it") }
        content.addText("Source currency audit", heading = true)
        report.currencyTotals.forEach { source ->
            val amount = if (provisional) source.confirmedMinorUnits + source.provisionalMinorUnits else source.confirmedMinorUnits
            content.addText("${source.currency}: ${formatMinorUnits(amount, source.currency)} · original source amount")
        }

        setContentView(ScrollView(this).apply { addView(content) })
    }

    private fun Int.dp(): Int = (this * resources.displayMetrics.density).toInt()

    private fun LinearLayout.addText(value: String, heading: Boolean = false) {
        addView(TextView(this@FxReportPreviewActivity).apply {
            text = value
            textSize = if (heading) 20f else 15f
            setTextColor(Color.rgb(24, 32, 31))
            if (heading) setTypeface(typeface, Typeface.BOLD)
            setPadding(0, 0, 0, 12.dp())
        }, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
    }

    companion object {
        const val ACTION = "com.lofuyu.borderledger.debug.FX_REPORT_PREVIEW"
        const val EXTRA_SCENARIO = "scenario"
    }
}
