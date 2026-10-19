package com.lofuyu.borderledger.ui.ledger

/**
 * The small, owner-authorized read model consumed by the native shell.
 *
 * The server remains the source of truth.  This model deliberately contains
 * no editable or client-confirmed state; a cache entry is only a renderable
 * snapshot with provenance and freshness metadata.
 */
data class LedgerSnapshot(
    val schemaVersion: Int,
    val snapshotAt: String,
    val timeZone: String,
    val accounts: List<LedgerAccount>,
    val transactions: List<LedgerTransaction>,
    val recurring: List<RecurringSummary>,
    val reviews: List<ReviewItem>,
    val report: LedgerReport? = null,
)

data class LedgerReport(
    val timeBasis: String,
    val currencyTotals: List<LedgerReportCurrencyTotal>,
    val dailyTotals: List<LedgerReportDailyTotal>,
    val reviewCount: Int,
    val excludedCount: Int,
    val from: String? = null,
    val to: String? = null,
    val includeProvisional: Boolean = false,
    val timeZone: String? = null,
    val asOf: String? = null,
    val sourceCoverage: Map<String, Int> = emptyMap(),
    val reportingCurrency: String? = null,
    val convertedTotals: LedgerReportConvertedTotals? = null,
    val convertedDailyTotals: List<LedgerReportConvertedDailyTotal> = emptyList(),
    val fx: LedgerReportFx = LedgerReportFx.EMPTY,
)

data class LedgerReportCurrencyTotal(
    val currency: String,
    val confirmedMinorUnits: Long,
    val provisionalMinorUnits: Long,
    val confirmedCount: Int,
    val provisionalCount: Int,
)

data class LedgerReportDailyTotal(
    val date: String,
    val currency: String,
    val confirmedMinorUnits: Long,
    val provisionalMinorUnits: Long,
)

data class LedgerReportConvertedTotals(
    val confirmedMinorUnits: Long,
    val provisionalMinorUnits: Long,
    val confirmedCount: Int,
    val provisionalCount: Int,
)

data class LedgerReportConvertedDailyTotal(
    val date: String,
    val confirmedMinorUnits: Long,
    val provisionalMinorUnits: Long,
)

data class LedgerFxDateRange(
    val earliest: String?,
    val latest: String?,
)

data class ChineseBankBand(
    val eligible: Boolean,
    val currency: String,
    val baseMinorUnits: Long,
    val lowerMinorUnits: Long,
    val upperMinorUnits: Long,
    val percentageBasisPoints: Int,
)

data class LedgerReportFx(
    val provider: String,
    val complete: Boolean,
    val unavailableSourceCurrencies: List<String>,
    val lockedDateCount: Int,
    val observedDateRange: LedgerFxDateRange,
    val chineseBankBand: ChineseBankBand?,
) {
    companion object {
        val EMPTY = LedgerReportFx(
            provider = "frankfurter",
            complete = true,
            unavailableSourceCurrencies = emptyList(),
            lockedDateCount = 0,
            observedDateRange = LedgerFxDateRange(null, null),
            chineseBankBand = null,
        )
    }
}

data class LedgerAccount(
    val id: String,
    val displayName: String,
    val institution: String?,
    val instrument: String?,
    val currencies: List<String>,
    val lastSuccessfulSyncAt: String?,
)

data class LedgerTransaction(
    val id: String,
    val occurredAt: String,
    val currency: String,
    val signedMinorUnits: Long,
    val merchant: String?,
    val accountLabel: String?,
    val status: String,
    val sourceLabel: String?,
    val category: String?,
    val note: String?,
    val kind: String = "expense",
    val revision: Int = 0,
    val accountId: String? = null,
)

data class LedgerTransactionPage(
    val items: List<LedgerTransaction>,
    val nextCursor: String?,
    val limit: Int,
)

data class RecurringSummary(
    val id: String,
    val label: String,
    val currency: String,
    val monthlyMinorUnits: Long?,
    val classification: String?,
    val nextDueAt: String?,
)

data class ReviewItem(
    val id: String,
    val reason: String,
    val currency: String?,
    val affectedMinorUnits: Long?,
    val candidateLabel: String?,
    val status: String,
)
