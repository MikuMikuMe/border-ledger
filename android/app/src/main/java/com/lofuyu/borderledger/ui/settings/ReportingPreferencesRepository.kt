package com.lofuyu.borderledger.ui.settings

import com.lofuyu.borderledger.auth.ApiEnvironment
import com.lofuyu.borderledger.auth.MobileRequest
import com.lofuyu.borderledger.auth.OwnerAuthInterceptor
import com.lofuyu.borderledger.auth.OwnerCredentialProvider
import com.lofuyu.borderledger.parser.CurrencyRegistry
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.util.Locale

private val registeredCurrencyRegistry = CurrencyRegistry()

/** Null keeps source-currency totals; every other option comes from the shared registry. */
fun reportingCurrencyOptions(): List<String?> = listOf(null) + CurrencyRegistry.DEFAULT_CODES.sorted()

private fun normalizeRegisteredCurrency(value: String?): String? {
    val normalized = value?.trim()?.uppercase(Locale.ROOT)?.ifBlank { null }
    if (normalized != null && registeredCurrencyRegistry.metadata(normalized) == null) {
        throw IllegalArgumentException("Preferred currency is not registered.")
    }
    return normalized
}

data class ReportingPreferences(
    val reportingTimezone: String,
    val weekStart: Int,
    val preferredCurrency: String?,
    val revision: Int,
    val updatedAt: String? = null,
) {
    init {
        require(reportingTimezone.isNotBlank() && reportingTimezone.length <= 128)
        require(weekStart in 0..6)
        require(revision >= 0)
        require(preferredCurrency == null || registeredCurrencyRegistry.metadata(preferredCurrency) != null)
    }

    companion object {
        val DEFAULT = ReportingPreferences("America/Toronto", 1, null, 0)
    }
}

data class ReportingPreferencesUpdate(
    val reportingTimezone: String,
    val weekStart: Int,
    val preferredCurrency: String?,
)

interface ReportingPreferencesRepository {
    class RevisionConflict(val currentRevision: Int) : Exception("Reporting preferences changed on another client.")
    class Offline : Exception("Reporting preferences are unavailable offline.")

    suspend fun read(): ReportingPreferences
    suspend fun update(expectedRevision: Int, update: ReportingPreferencesUpdate): ReportingPreferences
}

data class PreferencesHttpResponse(val statusCode: Int, val body: String)

interface PreferencesHttpTransport {
    suspend fun execute(request: MobileRequest): PreferencesHttpResponse
}

class HttpWorkerReportingPreferencesRepository(
    private val origin: String,
    environment: String,
    ownerCredentials: OwnerCredentialProvider,
    private val transport: PreferencesHttpTransport = UrlConnectionPreferencesTransport(),
) : ReportingPreferencesRepository {
    private val interceptor = OwnerAuthInterceptor(ownerCredentials, ApiEnvironment(origin, environment))

    override suspend fun read(): ReportingPreferences = request(MobileRequest("GET", "$origin/api/mobile/v1/preferences"))

    override suspend fun update(expectedRevision: Int, update: ReportingPreferencesUpdate): ReportingPreferences {
        require(expectedRevision >= 0)
        require(update.reportingTimezone.isNotBlank() && update.reportingTimezone.length <= 128)
        require(update.weekStart in 0..6)
        val preferredCurrency = normalizeRegisteredCurrency(update.preferredCurrency)
        val body = JSONObject()
            .put("expectedRevision", expectedRevision)
            .put("reportingTimezone", update.reportingTimezone)
            .put("weekStart", update.weekStart)
            .put("preferredCurrency", preferredCurrency ?: JSONObject.NULL)
            .toString()
        val response = execute(
            MobileRequest(
                "PATCH",
                "$origin/api/mobile/v1/preferences",
                headers = mapOf("Content-Type" to "application/json; charset=utf-8"),
                body = body.toByteArray(StandardCharsets.UTF_8),
            ),
        )
        if (response.statusCode == 409) {
            val revision = JSONObject(response.body).optInt("currentRevision", expectedRevision)
            throw ReportingPreferencesRepository.RevisionConflict(revision)
        }
        return parseSuccess(response)
    }

    private suspend fun request(request: MobileRequest): ReportingPreferences = parseSuccess(execute(request))

    private suspend fun execute(request: MobileRequest): PreferencesHttpResponse = try {
        transport.execute(interceptor.intercept(request))
    } catch (_: IOException) {
        throw ReportingPreferencesRepository.Offline()
    }

    private fun parseSuccess(response: PreferencesHttpResponse): ReportingPreferences {
        if (response.statusCode !in 200..299) throw IllegalStateException("Reporting preferences request failed (${response.statusCode}).")
        val json = JSONObject(response.body)
        return ReportingPreferences(
            reportingTimezone = json.getString("reportingTimezone"),
            weekStart = json.getInt("weekStart"),
            preferredCurrency = if (json.isNull("preferredCurrency")) null else json.getString("preferredCurrency"),
            revision = json.getInt("revision"),
            updatedAt = json.optString("updatedAt").ifBlank { null },
        )
    }
}

private class UrlConnectionPreferencesTransport : PreferencesHttpTransport {
    override suspend fun execute(request: MobileRequest): PreferencesHttpResponse = withContext(Dispatchers.IO) {
        val connection = try {
            (URL(request.url).openConnection() as HttpURLConnection).apply {
                requestMethod = request.method
                connectTimeout = TIMEOUT_MILLIS
                readTimeout = TIMEOUT_MILLIS
                setRequestProperty("Accept", "application/json")
                setRequestProperty("Cache-Control", "no-store")
                request.headers.forEach { (name, value) -> setRequestProperty(name, value) }
                if (request.body != null) doOutput = true
            }
        } catch (error: IOException) {
            throw error
        }
        try {
            request.body?.let { connection.outputStream.use { output -> output.write(it) } }
            val status = connection.responseCode
            val stream = if (status in 200..499) connection.inputStream else connection.errorStream
            PreferencesHttpResponse(status, stream?.bufferedReader(StandardCharsets.UTF_8)?.use { it.readText() }.orEmpty())
        } finally {
            connection.disconnect()
        }
    }

    private companion object { const val TIMEOUT_MILLIS = 15_000 }
}
