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
        setContentView(createPreview())
    }

    private fun createPreview(): ScrollView {
        val case = FxReportPreviewCase.fromIntentValue(intent.getStringExtra(EXTRA_SCENARIO))
        val report = FxReportPreviewFixture.report(case)
        val content = createContentColumn()

        content.addText("FX report preview · ${case.intentValue}", heading = true)
        content.addText("Debug fixture only. No owner credential, network request, or Frankfurter call is used.")
        addTotalSummary(content, report, case == FxReportPreviewCase.PROVISIONAL)
        addDailyTotals(content, report, case == FxReportPreviewCase.PROVISIONAL)
        addChineseBankBand(content, report)
        addCurrencyAudit(content, report, case == FxReportPreviewCase.PROVISIONAL)

        return ScrollView(this).apply { addView(content) }
    }

    private fun createContentColumn() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(20.dp(), 20.dp(), 20.dp(), 20.dp())
        setBackgroundColor(0xFFF3EFE6.toInt())
    }

    private fun addTotalSummary(content: LinearLayout, report: LedgerReport, includeProvisional: Boolean) {
        content.addText("Total spending in ${report.reportingCurrency ?: "source currencies"}", heading = true)
        val totals = report.convertedTotals
        if (totals == null) {
            content.addText("No converted total is available for this fixture.")
            return
        }

        val amount = reportAmount(totals.confirmedMinorUnits, totals.provisionalMinorUnits, includeProvisional)
        content.addText(formatMinorUnits(amount, report.reportingCurrency ?: "CAD"))
        content.addText(if (report.fx.complete) "Locked to purchase dates using Frankfurter daily rates." else "Partial conversion; source audit remains available.")
        if (!report.fx.complete) {
            content.addText("Unavailable source currencies: ${report.fx.unavailableSourceCurrencies.joinToString()}")
        }
    }

    private fun addDailyTotals(content: LinearLayout, report: LedgerReport, includeProvisional: Boolean) {
        content.addText("Converted daily totals", heading = true)
        report.convertedDailyTotals.forEach { daily ->
            val amount = reportAmount(daily.confirmedMinorUnits, daily.provisionalMinorUnits, includeProvisional)
            content.addText("${daily.date} · ${report.reportingCurrency}: ${formatMinorUnits(amount, report.reportingCurrency ?: "CAD")}")
        }
    }

    private fun addChineseBankBand(content: LinearLayout, report: LedgerReport) {
        report.fx.chineseBankBand?.let { content.addText("Chinese bank band fixture: $it") }
    }

    private fun addCurrencyAudit(content: LinearLayout, report: LedgerReport, includeProvisional: Boolean) {
        content.addText("Source currency audit", heading = true)
        report.currencyTotals.forEach { source ->
            val amount = reportAmount(source.confirmedMinorUnits, source.provisionalMinorUnits, includeProvisional)
            content.addText("${source.currency}: ${formatMinorUnits(amount, source.currency)} · original source amount")
        }
    }

    private fun reportAmount(confirmed: Long, provisional: Long, includeProvisional: Boolean) =
        if (includeProvisional) confirmed + provisional else confirmed

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
