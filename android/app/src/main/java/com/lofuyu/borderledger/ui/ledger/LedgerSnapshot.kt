package com.lofuyu.borderledger.ui.ledger

import android.util.JsonReader
import android.util.JsonToken
import com.lofuyu.borderledger.parser.CurrencyRegistry
import java.io.ByteArrayInputStream
import java.io.InputStreamReader
import java.nio.charset.StandardCharsets


sealed interface LedgerSnapshotDecodeResult {
    data class Ready(val snapshot: LedgerSnapshot) : LedgerSnapshotDecodeResult
    data class Unsupported(val message: String) : LedgerSnapshotDecodeResult
}

sealed interface LedgerReportDecodeResult {
    data class Ready(val report: LedgerReport) : LedgerReportDecodeResult
    data class Unsupported(val message: String) : LedgerReportDecodeResult
}

sealed interface LedgerTransactionPageDecodeResult {
    data class Ready(val page: LedgerTransactionPage) : LedgerTransactionPageDecodeResult
    data class Unsupported(val message: String) : LedgerTransactionPageDecodeResult
}

/**
 * Bounded decoder for the versioned owner snapshot JSON returned by the
 * mobile read API.  It intentionally rejects unknown versions and malformed
 * required fields instead of guessing at financial values.
 */
object LedgerSnapshotDecoder {
    private const val CURRENT_SCHEMA = 1
    private const val MAX_ACCOUNTS = 500
    private const val MAX_TRANSACTIONS = 5_000
    private const val MAX_RECURRING = 1_000
    private const val MAX_REVIEWS = 1_000
    private const val MAX_STRING = 512

    fun decode(payload: ByteArray): LedgerSnapshotDecodeResult {
        if (payload.isEmpty()) return LedgerSnapshotDecodeResult.Unsupported("The owner snapshot is empty.")
        if (payload.size > 2 * 1024 * 1024) return LedgerSnapshotDecodeResult.Unsupported("The owner snapshot is too large.")
        return runCatching {
            JsonReader(InputStreamReader(ByteArrayInputStream(payload), StandardCharsets.UTF_8)).use { reader ->
                readSnapshot(reader)
            }
        }.fold(
            onSuccess = { LedgerSnapshotDecodeResult.Ready(it) },
            onFailure = { LedgerSnapshotDecodeResult.Unsupported("The owner snapshot could not be read safely.") },
        )
    }

    fun decodeReportSummary(payload: ByteArray, includeProvisional: Boolean): LedgerReportDecodeResult {
        if (payload.isEmpty()) return LedgerReportDecodeResult.Unsupported("The owner report is empty.")
        if (payload.size > 512 * 1024) return LedgerReportDecodeResult.Unsupported("The owner report is too large.")
        return runCatching {
            JsonReader(InputStreamReader(ByteArrayInputStream(payload), StandardCharsets.UTF_8)).use { reader ->
                readReportSummary(reader, includeProvisional)
            }
        }.fold(
            onSuccess = { LedgerReportDecodeResult.Ready(it) },
            onFailure = { LedgerReportDecodeResult.Unsupported("The owner report could not be read safely.") },
        )
    }

    fun decodeTransactions(payload: ByteArray): LedgerTransactionPageDecodeResult {
        if (payload.isEmpty()) return LedgerTransactionPageDecodeResult.Unsupported("The owner Activity page is empty.")
        if (payload.size > 512 * 1024) return LedgerTransactionPageDecodeResult.Unsupported("The owner Activity page is too large.")
        return runCatching {
            JsonReader(InputStreamReader(ByteArrayInputStream(payload), StandardCharsets.UTF_8)).use { reader ->
                readTransactionPage(reader)
            }
        }.fold(
            onSuccess = { LedgerTransactionPageDecodeResult.Ready(it) },
            onFailure = { LedgerTransactionPageDecodeResult.Unsupported("The owner Activity page could not be read safely.") },
        )
    }

    private fun readSnapshot(reader: JsonReader): LedgerSnapshot {
        var schemaVersion: Int? = null
        var snapshotAt: String? = null
        var timeZone: String? = null
        var accounts: List<LedgerAccount> = emptyList()
        var transactions: List<LedgerTransaction> = emptyList()
        var recurring: List<RecurringSummary> = emptyList()
        var reviews: List<ReviewItem> = emptyList()
        var report: LedgerReport? = null

        reader.beginObject()
        while (reader.hasNext()) {
            when (reader.nextName()) {
                "schemaVersion" -> schemaVersion = reader.nextInt()
                "snapshotAt" -> snapshotAt = reader.nextStringBounded()
                "timeZone" -> timeZone = reader.nextStringBounded()
                "accounts" -> accounts = readArray(reader, MAX_ACCOUNTS) { readAccount(reader) }
                "transactions" -> transactions = readArray(reader, MAX_TRANSACTIONS) { readTransaction(reader) }
                "recurring" -> recurring = readArray(reader, MAX_RECURRING) { readRecurring(reader) }
                "reviews" -> reviews = readArray(reader, MAX_REVIEWS) { readReview(reader) }
                "report" -> report = readReport(reader)
                else -> reader.skipValue()
            }
        }
        reader.endObject()

        require(schemaVersion == CURRENT_SCHEMA)
        require(!snapshotAt.isNullOrBlank())
        require(!timeZone.isNullOrBlank())
        return LedgerSnapshot(
            schemaVersion = requireNotNull(schemaVersion),
            snapshotAt = requireNotNull(snapshotAt),
            timeZone = requireNotNull(timeZone),
            accounts = accounts,
            transactions = transactions,
            recurring = recurring,
            reviews = reviews,
            report = report,
        )
    }

    private fun readReport(reader: JsonReader): LedgerReport {
        var timeBasis: String? = null
        var from: String? = null
        var to: String? = null
        var includeProvisional = false
        var timeZone: String? = null
        var asOf: String? = null
        var currencyTotals: List<LedgerReportCurrencyTotal> = emptyList()
        var dailyTotals: List<LedgerReportDailyTotal> = emptyList()
        var reportingCurrency: String? = null
        var convertedTotals: LedgerReportConvertedTotals? = null
        var convertedDailyTotals: List<LedgerReportConvertedDailyTotal> = emptyList()
        var fx = LedgerReportFx.EMPTY
        var reviewCount = 0
        var excludedCount = 0
        var sourceCoverage: Map<String, Int> = emptyMap()
        reader.beginObject()
        while (reader.hasNext()) {
            when (reader.nextName()) {
                "timeBasis" -> timeBasis = reader.nextStringBounded()
                "from" -> from = reader.nextNullableStringBounded()
                "to" -> to = reader.nextNullableStringBounded()
                "includeProvisional" -> includeProvisional = reader.nextBoolean()
                "timeZone" -> timeZone = reader.nextStringBounded()
                "asOf" -> asOf = reader.nextStringBounded()
                // These are full-window aggregates. Their safety bound is the
                // snapshot payload limit, not the bounded render-array limits.
                "currencyTotals" -> currencyTotals = readArray(reader) { readReportCurrency(reader) }
                "dailyTotals" -> dailyTotals = readArray(reader) { readReportDaily(reader) }
                "reportingCurrency" -> reportingCurrency = reader.nextNullableCurrency()
                "convertedTotals" -> convertedTotals = readNullableConvertedTotals(reader)
                "convertedDailyTotals" -> convertedDailyTotals = readArray(reader) { readConvertedDaily(reader) }
                "fx" -> fx = readNullableFx(reader) ?: LedgerReportFx.EMPTY
                "reviewCount" -> reviewCount = reader.nextInt()
                "excludedCount" -> excludedCount = reader.nextInt()
                "sourceCoverage" -> sourceCoverage = readIntMap(reader, 64)
                else -> reader.skipValue()
            }
        }
        reader.endObject()
        return LedgerReport(
            timeBasis = requireNonBlank(timeBasis),
            currencyTotals = currencyTotals,
            dailyTotals = dailyTotals,
            reviewCount = reviewCount,
            excludedCount = excludedCount,
            from = from,
            to = to,
            includeProvisional = includeProvisional,
            timeZone = timeZone,
            asOf = asOf,
            sourceCoverage = sourceCoverage,
            reportingCurrency = reportingCurrency,
            convertedTotals = convertedTotals,
            convertedDailyTotals = convertedDailyTotals,
            fx = fx,
        )
    }

    private fun readReportSummary(reader: JsonReader, requestedIncludeProvisional: Boolean): LedgerReport {
        var startDate: String? = null
        var endDate: String? = null
        var checkedAt: String? = null
        var timeBasis: String? = null
        var timeZone: String? = null
        var confirmedByCurrency: Map<String, Long> = emptyMap()
        var provisionalByCurrency: Map<String, Long> = emptyMap()
        var dailyTotals: List<LedgerReportDailyTotal> = emptyList()
        var reportingCurrency: String? = null
        var convertedTotals: LedgerReportConvertedTotals? = null
        var convertedDailyTotals: List<LedgerReportConvertedDailyTotal> = emptyList()
        var fx = LedgerReportFx.EMPTY
        var reviewCount = 0
        var excludedCount = 0
        var sourceCoverage: Map<String, Int> = emptyMap()
        var nestedReport: LedgerReport? = null

        reader.beginObject()
        while (reader.hasNext()) {
            when (reader.nextName()) {
                "startDate" -> startDate = reader.nextStringBounded()
                "endDate" -> endDate = reader.nextStringBounded()
                "checkedAt" -> checkedAt = reader.nextStringBounded()
                "timeBasis" -> timeBasis = reader.nextStringBounded()
                "timeZone" -> timeZone = reader.nextStringBounded()
                "confirmedByCurrency" -> confirmedByCurrency = readLongMap(reader, 162)
                "provisionalByCurrency" -> provisionalByCurrency = readLongMap(reader, 162)
                "dailyTotals" -> dailyTotals = readArray(reader) { readReportDaily(reader) }
                "reportingCurrency" -> reportingCurrency = reader.nextNullableCurrency()
                "convertedTotals" -> convertedTotals = readNullableConvertedTotals(reader)
                "convertedDailyTotals" -> convertedDailyTotals = readArray(reader) { readConvertedDaily(reader) }
                "fx" -> fx = readNullableFx(reader) ?: LedgerReportFx.EMPTY
                "reviewCount" -> reviewCount = reader.nextInt()
                "excludedCount" -> excludedCount = reader.nextInt()
                "sourceCoverage" -> sourceCoverage = readIntMap(reader, 64)
                "report" -> nestedReport = readReport(reader)
                else -> reader.skipValue()
            }
        }
        reader.endObject()
        nestedReport?.let { return it }

        val currencies = (confirmedByCurrency.keys + provisionalByCurrency.keys).distinct().sorted()
        val totals = currencies.map { currency ->
            LedgerReportCurrencyTotal(
                currency = currency,
                confirmedMinorUnits = confirmedByCurrency[currency] ?: 0L,
                provisionalMinorUnits = provisionalByCurrency[currency] ?: 0L,
                confirmedCount = 0,
                provisionalCount = 0,
            )
        }
        return LedgerReport(
            timeBasis = requireNonBlank(timeBasis),
            currencyTotals = totals,
            dailyTotals = dailyTotals,
            reviewCount = reviewCount,
            excludedCount = excludedCount,
            from = requireNonBlank(startDate),
            to = requireNonBlank(endDate),
            includeProvisional = requestedIncludeProvisional,
            timeZone = timeZone,
            asOf = checkedAt,
            sourceCoverage = sourceCoverage,
            reportingCurrency = reportingCurrency,
            convertedTotals = convertedTotals,
            convertedDailyTotals = convertedDailyTotals,
            fx = fx,
        )
    }

    private fun readTransactionPage(reader: JsonReader): LedgerTransactionPage {
        var items: List<LedgerTransaction> = emptyList()
        var nextCursor: String? = null
        var limit: Int? = null
        reader.beginObject()
        while (reader.hasNext()) {
            when (reader.nextName()) {
                "items" -> items = readArray(reader, 100) { readRemoteTransaction(reader) }
                "page" -> {
                    reader.beginObject()
                    while (reader.hasNext()) {
                        when (reader.nextName()) {
                            "nextCursor" -> nextCursor = reader.nextNullableStringBounded()
                            "limit" -> limit = reader.nextInt()
                            else -> reader.skipValue()
                        }
                    }
                    reader.endObject()
                }
                else -> reader.skipValue()
            }
        }
        reader.endObject()
        val pageLimit = requireNotNull(limit)
        require(pageLimit in 1..100)
        require(nextCursor == null || nextCursor.length <= 512)
        return LedgerTransactionPage(items, nextCursor, pageLimit)
    }

    private fun readRemoteTransaction(reader: JsonReader): LedgerTransaction {
        var id: String? = null
        var accountId: String? = null
        var occurredAt: String? = null
        var merchant: String? = null
        var amountMinor: Long? = null
        var currency: String? = null
        var category: String? = null
        var kind: String? = null
        var status: String? = null
        var source: String? = null
        var note: String? = null
        var revision = 0
        reader.beginObject()
        while (reader.hasNext()) {
            when (reader.nextName()) {
                "id" -> id = reader.nextStringBounded()
                "accountId" -> accountId = reader.nextStringBounded()
                "date" -> occurredAt = reader.nextStringBounded()
                "merchant" -> merchant = reader.nextStringBounded()
                "amountMinor" -> amountMinor = reader.nextSafeLong()
                "currency" -> currency = reader.nextCurrency()
                "category" -> category = reader.nextStringBounded()
                "kind" -> kind = reader.nextStringBounded()
                "status" -> status = reader.nextStringBounded()
                "source" -> source = reader.nextStringBounded()
                "note" -> note = reader.nextNullableStringBounded()
                "revision" -> revision = reader.nextInt()
                else -> reader.skipValue()
            }
        }
        reader.endObject()
        val transactionKind = requireNonBlank(kind)
        val rawAmount = requireNotNull(amountMinor)
        val signedAmount = if (transactionKind == "refund") -kotlin.math.abs(rawAmount) else kotlin.math.abs(rawAmount)
        require(revision >= 0)
        return LedgerTransaction(
            id = requireNonBlank(id),
            occurredAt = requireNonBlank(occurredAt),
            currency = requireCurrency(currency),
            signedMinorUnits = signedAmount,
            merchant = requireNonBlank(merchant),
            accountLabel = null,
            status = requireNonBlank(status),
            sourceLabel = requireNonBlank(source),
            category = requireNonBlank(category),
            note = note,
            kind = transactionKind,
            revision = revision,
            accountId = requireNonBlank(accountId),
        )
    }

    private fun readReportCurrency(reader: JsonReader): LedgerReportCurrencyTotal {
        var currency: String? = null
        var confirmed: Long? = null
        var provisional: Long? = null
        var confirmedCount = 0
        var provisionalCount = 0
        reader.beginObject()
        while (reader.hasNext()) {
            when (reader.nextName()) {
                "currency" -> currency = reader.nextCurrency()
                "confirmedMinorUnits" -> confirmed = reader.nextSafeLong()
                "provisionalMinorUnits" -> provisional = reader.nextSafeLong()
                "confirmedCount" -> confirmedCount = reader.nextNonNegativeInt()
                "provisionalCount" -> provisionalCount = reader.nextNonNegativeInt()
                else -> reader.skipValue()
            }
        }
        reader.endObject()
        return LedgerReportCurrencyTotal(requireCurrency(currency), requireNotNull(confirmed), requireNotNull(provisional), confirmedCount, provisionalCount)
    }

    private fun readReportDaily(reader: JsonReader): LedgerReportDailyTotal {
        var date: String? = null
        var currency: String? = null
        var confirmed: Long? = null
        var provisional: Long? = null
        reader.beginObject()
        while (reader.hasNext()) {
            when (reader.nextName()) {
                "date" -> date = reader.nextStringBounded()
                "currency" -> currency = reader.nextCurrency()
                "confirmedMinorUnits" -> confirmed = reader.nextSafeLong()
                "provisionalMinorUnits" -> provisional = reader.nextSafeLong()
                else -> reader.skipValue()
            }
        }
        reader.endObject()
        return LedgerReportDailyTotal(requireNonBlank(date), requireCurrency(currency), requireNotNull(confirmed), requireNotNull(provisional))
    }

    private fun readNullableConvertedTotals(reader: JsonReader): LedgerReportConvertedTotals? {
        if (reader.peek() == JsonToken.NULL) {
            reader.nextNull()
            return null
        }
        var confirmed: Long? = null
        var provisional: Long? = null
        var confirmedCount: Int? = null
        var provisionalCount: Int? = null
        reader.beginObject()
        while (reader.hasNext()) {
            when (reader.nextName()) {
                "confirmedMinorUnits" -> confirmed = reader.nextSafeLong()
                "provisionalMinorUnits" -> provisional = reader.nextSafeLong()
                "confirmedCount" -> confirmedCount = reader.nextNonNegativeInt()
                "provisionalCount" -> provisionalCount = reader.nextNonNegativeInt()
                else -> reader.skipValue()
            }
        }
        reader.endObject()
        return LedgerReportConvertedTotals(
            confirmedMinorUnits = requireNotNull(confirmed),
            provisionalMinorUnits = requireNotNull(provisional),
            confirmedCount = requireNotNull(confirmedCount),
            provisionalCount = requireNotNull(provisionalCount),
        )
    }

    private fun readConvertedDaily(reader: JsonReader): LedgerReportConvertedDailyTotal {
        var date: String? = null
        var confirmed: Long? = null
        var provisional: Long? = null
        reader.beginObject()
        while (reader.hasNext()) {
            when (reader.nextName()) {
                "date" -> date = reader.nextStringBounded()
                "confirmedMinorUnits" -> confirmed = reader.nextSafeLong()
                "provisionalMinorUnits" -> provisional = reader.nextSafeLong()
                else -> reader.skipValue()
            }
        }
        reader.endObject()
        return LedgerReportConvertedDailyTotal(requireNonBlank(date), requireNotNull(confirmed), requireNotNull(provisional))
    }

    private fun readNullableFx(reader: JsonReader): LedgerReportFx? {
        if (reader.peek() == JsonToken.NULL) {
            reader.nextNull()
            return null
        }
        var provider: String? = null
        var complete: Boolean? = null
        var unavailable = emptyList<String>()
        var lockedDateCount: Int? = null
        var observedDateRange = LedgerFxDateRange(null, null)
        var chineseBankBand: ChineseBankBand? = null
        reader.beginObject()
        while (reader.hasNext()) {
            when (reader.nextName()) {
                "provider" -> provider = reader.nextStringBounded()
                "complete" -> complete = reader.nextBoolean()
                "unavailableSourceCurrencies" -> unavailable = readCurrencyArray(reader, 162)
                "lockedDateCount" -> lockedDateCount = reader.nextNonNegativeInt()
                "observedDateRange" -> observedDateRange = readDateRange(reader)
                "chineseBankBand" -> chineseBankBand = readNullableChineseBankBand(reader)
                else -> reader.skipValue()
            }
        }
        reader.endObject()
        return LedgerReportFx(
            provider = requireNonBlank(provider),
            complete = requireNotNull(complete),
            unavailableSourceCurrencies = unavailable,
            lockedDateCount = requireNotNull(lockedDateCount),
            observedDateRange = observedDateRange,
            chineseBankBand = chineseBankBand,
        )
    }

    private fun readDateRange(reader: JsonReader): LedgerFxDateRange {
        var earliest: String? = null
        var latest: String? = null
        reader.beginObject()
        while (reader.hasNext()) {
            when (reader.nextName()) {
                "earliest" -> earliest = reader.nextNullableStringBounded()
                "latest" -> latest = reader.nextNullableStringBounded()
                else -> reader.skipValue()
            }
        }
        reader.endObject()
        return LedgerFxDateRange(earliest, latest)
    }

    private fun readNullableChineseBankBand(reader: JsonReader): ChineseBankBand? {
        if (reader.peek() == JsonToken.NULL) {
            reader.nextNull()
            return null
        }
        var eligible: Boolean? = null
        var currency: String? = null
        var base: Long? = null
        var lower: Long? = null
        var upper: Long? = null
        var basisPoints: Int? = null
        reader.beginObject()
        while (reader.hasNext()) {
            when (reader.nextName()) {
                "eligible" -> eligible = reader.nextBoolean()
                "currency" -> currency = reader.nextCurrency()
                "baseMinorUnits" -> base = reader.nextSafeLong()
                "lowerMinorUnits" -> lower = reader.nextSafeLong()
                "upperMinorUnits" -> upper = reader.nextSafeLong()
                "percentageBasisPoints" -> basisPoints = reader.nextNonNegativeInt()
                else -> reader.skipValue()
            }
        }
        reader.endObject()
        require(eligible == true)
        require(basisPoints == 150)
        return ChineseBankBand(
            eligible = true,
            currency = requireCurrency(currency),
            baseMinorUnits = requireNotNull(base),
            lowerMinorUnits = requireNotNull(lower),
            upperMinorUnits = requireNotNull(upper),
            percentageBasisPoints = 150,
        )
    }

    private fun readAccount(reader: JsonReader): LedgerAccount {
        var id: String? = null
        var displayName: String? = null
        var institution: String? = null
        var instrument: String? = null
        var currencies = emptyList<String>()
        var lastSuccessfulSyncAt: String? = null
        reader.beginObject()
        while (reader.hasNext()) {
            when (reader.nextName()) {
                "id" -> id = reader.nextStringBounded()
                "displayName" -> displayName = reader.nextStringBounded()
                "institution" -> institution = reader.nextNullableStringBounded()
                "instrument" -> instrument = reader.nextNullableStringBounded()
                "currencies" -> currencies = readCurrencyArray(reader, 16)
                "lastSuccessfulSyncAt" -> lastSuccessfulSyncAt = reader.nextNullableStringBounded()
                else -> reader.skipValue()
            }
        }
        reader.endObject()
        return LedgerAccount(
            id = requireNonBlank(id),
            displayName = requireNonBlank(displayName),
            institution = institution,
            instrument = instrument,
            currencies = currencies,
            lastSuccessfulSyncAt = lastSuccessfulSyncAt,
        )
    }

    private fun readTransaction(reader: JsonReader): LedgerTransaction {
        var id: String? = null
        var accountId: String? = null
        var occurredAt: String? = null
        var currency: String? = null
        var signedMinorUnits: Long? = null
        var merchant: String? = null
        var accountLabel: String? = null
        var status: String? = null
        var sourceLabel: String? = null
        var category: String? = null
        var note: String? = null
        var kind = "expense"
        var revision = 0
        reader.beginObject()
        while (reader.hasNext()) {
            when (reader.nextName()) {
                "id" -> id = reader.nextStringBounded()
                "accountId" -> accountId = reader.nextStringBounded()
                "occurredAt" -> occurredAt = reader.nextStringBounded()
                "currency" -> currency = reader.nextCurrency()
                "signedMinorUnits" -> signedMinorUnits = reader.nextSafeLong()
                "merchant" -> merchant = reader.nextNullableStringBounded()
                "accountLabel" -> accountLabel = reader.nextNullableStringBounded()
                "status" -> status = reader.nextStringBounded()
                "sourceLabel" -> sourceLabel = reader.nextNullableStringBounded()
                "category" -> category = reader.nextNullableStringBounded()
                "note" -> note = reader.nextNullableStringBounded()
                "kind" -> kind = reader.nextStringBounded()
                "revision" -> revision = reader.nextInt()
                else -> reader.skipValue()
            }
        }
        reader.endObject()
        return LedgerTransaction(
            id = requireNonBlank(id),
            occurredAt = requireNonBlank(occurredAt),
            currency = requireCurrency(currency),
            signedMinorUnits = requireNotNull(signedMinorUnits),
            merchant = merchant,
            accountLabel = accountLabel,
            status = requireNonBlank(status),
            sourceLabel = sourceLabel,
            category = category,
            note = note,
            kind = kind,
            revision = revision,
            accountId = accountId,
        )
    }

    private fun readRecurring(reader: JsonReader): RecurringSummary {
        var id: String? = null
        var label: String? = null
        var currency: String? = null
        var monthlyMinorUnits: Long? = null
        var classification: String? = null
        var nextDueAt: String? = null
        reader.beginObject()
        while (reader.hasNext()) {
            when (reader.nextName()) {
                "id" -> id = reader.nextStringBounded()
                "label" -> label = reader.nextStringBounded()
                "currency" -> currency = reader.nextCurrency()
                "monthlyMinorUnits" -> monthlyMinorUnits = reader.nextNullableSafeLong()
                "classification" -> classification = reader.nextNullableStringBounded()
                "nextDueAt" -> nextDueAt = reader.nextNullableStringBounded()
                else -> reader.skipValue()
            }
        }
        reader.endObject()
        return RecurringSummary(requireNonBlank(id), requireNonBlank(label), requireCurrency(currency), monthlyMinorUnits, classification, nextDueAt)
    }

    private fun readReview(reader: JsonReader): ReviewItem {
        var id: String? = null
        var reason: String? = null
        var currency: String? = null
        var affectedMinorUnits: Long? = null
        var candidateLabel: String? = null
        var status: String? = null
        reader.beginObject()
        while (reader.hasNext()) {
            when (reader.nextName()) {
                "id" -> id = reader.nextStringBounded()
                "reason" -> reason = reader.nextStringBounded()
                "currency" -> currency = reader.nextNullableCurrency()
                "affectedMinorUnits" -> affectedMinorUnits = reader.nextNullableSafeLong()
                "candidateLabel" -> candidateLabel = reader.nextNullableStringBounded()
                "status" -> status = reader.nextStringBounded()
                else -> reader.skipValue()
            }
        }
        reader.endObject()
        return ReviewItem(requireNonBlank(id), requireNonBlank(reason), currency, affectedMinorUnits, candidateLabel, requireNonBlank(status))
    }

    private fun readLongMap(reader: JsonReader, max: Int): Map<String, Long> {
        val values = LinkedHashMap<String, Long>()
        reader.beginObject()
        while (reader.hasNext()) {
            require(values.size < max)
            val key = reader.nextName()
            require(key.isNotBlank() && key.length <= MAX_STRING)
            values[requireCurrency(key)] = reader.nextSafeLong()
        }
        reader.endObject()
        return values
    }

    private fun readIntMap(reader: JsonReader, max: Int): Map<String, Int> {
        val values = LinkedHashMap<String, Int>()
        reader.beginObject()
        while (reader.hasNext()) {
            require(values.size < max)
            val key = reader.nextName()
            require(key.isNotBlank() && key.length <= MAX_STRING)
            val value = reader.nextInt()
            require(value >= 0)
            values[key] = value
        }
        reader.endObject()
        return values
    }

    private fun <T> readArray(reader: JsonReader, max: Int, readItem: () -> T): List<T> {
        val values = ArrayList<T>()
        reader.beginArray()
        while (reader.hasNext()) {
            require(values.size < max)
            values += readItem()
        }
        reader.endArray()
        return values
    }

    private fun <T> readArray(reader: JsonReader, readItem: () -> T): List<T> {
        val values = ArrayList<T>()
        reader.beginArray()
        while (reader.hasNext()) values += readItem()
        reader.endArray()
        return values
    }

    private fun readStringArray(reader: JsonReader, max: Int): List<String> {
        val values = ArrayList<String>()
        reader.beginArray()
        while (reader.hasNext()) {
            require(values.size < max)
            values += reader.nextStringBounded()
        }
        reader.endArray()
        return values
    }

    private fun readCurrencyArray(reader: JsonReader, max: Int): List<String> {
        val values = ArrayList<String>()
        reader.beginArray()
        while (reader.hasNext()) {
            require(values.size < max)
            values += requireCurrency(reader.nextStringBounded())
        }
        reader.endArray()
        return values
    }

    private fun requireNonBlank(value: String?): String = requireNotNull(value).also { require(it.isNotBlank()) }

    private fun requireCurrency(value: String?): String {
        val normalized = requireNonBlank(value)
        return requireNotNull(CurrencyRegistry().metadata(normalized)?.code) { "Currency is not registered." }
    }

    private fun JsonReader.nextStringBounded(): String {
        require(peek() == JsonToken.STRING)
        return nextString().also { require(it.length <= MAX_STRING) }
    }

    private fun JsonReader.nextNullableStringBounded(): String? = if (peek() == JsonToken.NULL) {
        nextNull()
        null
    } else {
        nextStringBounded()
    }

    private fun JsonReader.nextCurrency(): String = requireCurrency(nextStringBounded())

    private fun JsonReader.nextNullableCurrency(): String? = if (peek() == JsonToken.NULL) {
        nextNull()
        null
    } else {
        nextCurrency()
    }

    private fun JsonReader.nextNullableSafeLong(): Long? = if (peek() == JsonToken.NULL) {
        nextNull()
        null
    } else {
        nextSafeLong()
    }

    private fun JsonReader.nextSafeLong(): Long {
        require(peek() == JsonToken.NUMBER)
        val raw = nextString()
        require(INTEGER_NUMBER.matches(raw))
        val value = raw.toLongOrNull() ?: throw IllegalArgumentException("Number is outside Long range.")
        require(value in CurrencyRegistry.MIN_SAFE_INTEGER..CurrencyRegistry.MAX_SAFE_INTEGER)
        return value
    }

    private fun JsonReader.nextNonNegativeInt(): Int {
        val value = nextSafeLong()
        require(value in 0..Int.MAX_VALUE)
        return value.toInt()
    }

    private val INTEGER_NUMBER = Regex("-?(0|[1-9]\\d*)")
}
