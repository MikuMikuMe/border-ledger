package com.lofuyu.borderledger.api

import com.lofuyu.borderledger.auth.ApiEnvironment
import com.lofuyu.borderledger.auth.MobileRequest
import com.lofuyu.borderledger.auth.OwnerAuthInterceptor
import com.lofuyu.borderledger.auth.OwnerCredentialProvider
import com.lofuyu.borderledger.parser.CurrencyRegistry
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

private val OWNER_DATE_PATTERN = Regex("^\\d{4}-\\d{2}-\\d{2}$")
private val OWNER_TIME_ZONES = setOf("America/Toronto", "Asia/Shanghai", "UTC")
private val OWNER_TRANSACTION_STATUSES = setOf("confirmed", "provisional", "needs_review")
private val OWNER_TRANSACTION_SOURCES = setOf("statement", "plaid", "alert", "manual", "lunchflow")

data class OwnerReportQuery(
    val startDate: String,
    val endDate: String,
    val includeProvisional: Boolean = false,
    val currency: String? = null,
    val reportingCurrency: String? = null,
    val timeZone: String = "America/Toronto",
) {
    init {
        require(startDate.matches(OWNER_DATE_PATTERN) && endDate.matches(OWNER_DATE_PATTERN)) { "Report dates must use YYYY-MM-DD." }
        require(startDate <= endDate) { "Report start date must not be after the end date." }
        require(currency == null || CurrencyRegistry().metadata(currency) != null) { "Report currency is not registered." }
        require(reportingCurrency == null || CurrencyRegistry().metadata(reportingCurrency) != null) { "Reporting currency is not registered." }
        require(timeZone in OWNER_TIME_ZONES) { "Report timezone is not supported." }
    }
}

internal fun ownerReportRequestUrl(origin: String, query: OwnerReportQuery): String {
    val params = linkedMapOf(
        "startDate" to query.startDate,
        "endDate" to query.endDate,
        "includeProvisional" to query.includeProvisional.toString(),
        "timeZone" to query.timeZone,
    )
    query.currency?.let { params["currency"] = it }
    query.reportingCurrency?.let { params["reportingCurrency"] = it }
    return "$origin/api/mobile/v1/reports/summary${params.entries.joinToString(prefix = "?", separator = "&") { "${URLEncoder.encode(it.key, Charsets.UTF_8.name())}=${URLEncoder.encode(it.value, Charsets.UTF_8.name())}" }}"
}

data class OwnerTransactionQuery(
    val cursor: String? = null,
    val limit: Int = 50,
    val query: String? = null,
    val currency: String? = null,
    val status: String? = null,
    val source: String? = null,
    val category: String? = null,
) {
    init {
        require(limit in 1..100) { "Transaction page size must be between 1 and 100." }
        require(cursor == null || cursor.length <= 512) { "Transaction cursor is too long." }
        require(query == null || query.length <= 120) { "Transaction query is too long." }
        require(currency == null || CurrencyRegistry().metadata(currency) != null) { "Transaction currency is not registered." }
        require(status == null || status in OWNER_TRANSACTION_STATUSES) { "Transaction status is not supported." }
        require(source == null || source in OWNER_TRANSACTION_SOURCES) { "Transaction source is not supported." }
        require(category == null || category.length in 1..80) { "Transaction category is not valid." }
    }
}

interface OwnerLedgerApi {
    /** Returns the versioned, owner-authorized snapshot JSON bytes. */
    suspend fun readSnapshot(): ByteArray

    /** Returns a selected, full-window owner report independent of list pagination. */
    suspend fun readReport(query: OwnerReportQuery): ByteArray = throw TransportFailure.Unavailable

    /** Returns a bounded, cursor-paginated canonical Activity page. */
    suspend fun readTransactions(query: OwnerTransactionQuery = OwnerTransactionQuery()): ByteArray = throw TransportFailure.Unavailable
}

class HttpWorkerOwnerLedgerApi(
    private val origin: String,
    environment: String,
    ownerCredentials: OwnerCredentialProvider,
) : OwnerLedgerApi {
    private val ownerInterceptor = OwnerAuthInterceptor(ownerCredentials, ApiEnvironment(origin, environment))

    override suspend fun readSnapshot(): ByteArray {
        return read("$origin/api/mobile/v1/ledger/snapshot", MAX_SNAPSHOT_BYTES)
    }

    override suspend fun readReport(query: OwnerReportQuery): ByteArray {
        return read(ownerReportRequestUrl(origin, query), MAX_REPORT_BYTES)
    }

    override suspend fun readTransactions(query: OwnerTransactionQuery): ByteArray {
        val params = linkedMapOf("limit" to query.limit.toString())
        query.cursor?.let { params["cursor"] = it }
        query.query?.takeIf { it.isNotBlank() }?.let { params["query"] = it }
        query.currency?.let { params["currency"] = it }
        query.status?.let { params["status"] = it }
        query.source?.let { params["source"] = it }
        query.category?.let { params["category"] = it }
        return read("$origin/api/mobile/v1/transactions${queryString(params)}", MAX_TRANSACTION_PAGE_BYTES)
    }

    private suspend fun read(url: String, maxBytes: Int): ByteArray {
        val request = ownerInterceptor.intercept(MobileRequest("GET", url))
        return withContext(Dispatchers.IO) {
            val connection = try {
                (URL(request.url).openConnection() as HttpURLConnection).apply {
                    requestMethod = request.method
                    connectTimeout = NETWORK_TIMEOUT_MILLIS
                    readTimeout = NETWORK_TIMEOUT_MILLIS
                    setRequestProperty("Accept", "application/json")
                    setRequestProperty("Cache-Control", "no-store")
                    request.headers.forEach { (name, value) -> setRequestProperty(name, value) }
                }
            } catch (_: IOException) {
                throw TransportFailure.Offline
            }
            try {
                val code = connection.responseCode
                val stream = if (code in 200..299) connection.inputStream else connection.errorStream
                if (code !in 200..299) throw when (code) {
                    HttpURLConnection.HTTP_UNAUTHORIZED, HttpURLConnection.HTTP_FORBIDDEN -> TransportFailure.Unauthorized
                    HttpURLConnection.HTTP_NOT_FOUND, HttpURLConnection.HTTP_NOT_IMPLEMENTED -> TransportFailure.Unavailable
                    else -> TransportFailure.Retryable
                }
                val bytes = stream?.use { input ->
                    val output = java.io.ByteArrayOutputStream()
                    val buffer = ByteArray(8 * 1024)
                    var total = 0
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        total += count
                        if (total > maxBytes) throw TransportFailure.Unavailable
                        output.write(buffer, 0, count)
                    }
                    output.toByteArray()
                } ?: ByteArray(0)
                if (bytes.isEmpty()) throw TransportFailure.Unavailable
                bytes
            } catch (error: TransportFailure) {
                throw error
            } catch (_: IOException) {
                throw TransportFailure.Offline
            } finally {
                connection.disconnect()
            }
        }
    }

    private fun queryString(values: Map<String, String>): String = values.entries.joinToString(prefix = "?", separator = "&") {
        "${encode(it.key)}=${encode(it.value)}"
    }

    private fun encode(value: String): String = URLEncoder.encode(value, Charsets.UTF_8.name())

    private companion object {
        const val NETWORK_TIMEOUT_MILLIS = 15_000
        const val MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024
        const val MAX_REPORT_BYTES = 512 * 1024
        const val MAX_TRANSACTION_PAGE_BYTES = 512 * 1024
    }
}
