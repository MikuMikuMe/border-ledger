package com.lofuyu.borderledger.ui.accounts.devices

import com.lofuyu.borderledger.api.TransportFailure
import com.lofuyu.borderledger.auth.ApiEnvironment
import com.lofuyu.borderledger.auth.CaptureProfileLoadResult
import com.lofuyu.borderledger.auth.CaptureProfileRepository
import com.lofuyu.borderledger.auth.CaptureProfileUnavailableReason
import com.lofuyu.borderledger.auth.CaptureSourceProfile
import com.lofuyu.borderledger.auth.MobileRequest
import com.lofuyu.borderledger.auth.OwnerAuthInterceptor
import com.lofuyu.borderledger.auth.OwnerCredentialProvider
import com.lofuyu.borderledger.capture.CaptureSourceProfileProvider
import com.lofuyu.borderledger.capture.SourceProfile
import com.lofuyu.borderledger.capture.SourceProfileKind
import com.lofuyu.borderledger.api.CaptureInstrumentHint
import com.lofuyu.borderledger.parser.InstrumentHintKind
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets

data class DeviceHttpResponse(val statusCode: Int, val body: String)

fun interface DeviceHttpTransport {
    suspend fun execute(request: MobileRequest): DeviceHttpResponse
}

class DeviceRevisionConflict(val currentRevision: Int?) : IOException("The device source scope changed; refresh before saving.")

private fun InstrumentHint.toCaptureInstrumentHintOrNull(): CaptureInstrumentHint? {
    val kind = InstrumentHintKind.entries.firstOrNull { it.wireValue == this.kind } ?: return null
    if (value.isBlank() || value != value.trim() || value.length > 64 || value.any(Char::isISOControl)) return null
    return CaptureInstrumentHint(kind.wireValue, value)
}

/** Owner-authenticated adapter for the existing mobile device-management routes. */
class HttpWorkerDeviceManagementRepository(
    private val origin: String,
    environment: String,
    ownerCredentials: OwnerCredentialProvider,
    private val transport: DeviceHttpTransport = UrlConnectionDeviceHttpTransport(),
) : DeviceManagementRepository {
    private val interceptor = OwnerAuthInterceptor(ownerCredentials, ApiEnvironment(origin, environment))

    override suspend fun readDevices(): List<MobileDevice> = JSONObject(execute(
        MobileRequest("GET", "$origin/api/mobile/v1/devices"),
    ).body).optJSONArray("devices").toMobileDevices()

    override suspend fun revoke(deviceId: String) {
        execute(MobileRequest("DELETE", "$origin/api/mobile/v1/devices/${encode(deviceId)}"))
    }

    override suspend fun replaceSourceConfig(config: DeviceSourceConfig): MobileDevice {
        require(config.expectedRevision >= 0)
        require(config.mappings.isNotEmpty())
        val mappings = JSONArray()
        config.mappings.forEach { mapping ->
            val value = JSONObject()
                .put("sourceProfileId", mapping.sourceProfileId)
                .put("accountId", mapping.accountId)
                .put("allowedCurrencies", JSONArray().also { currencies -> mapping.allowedCurrencies.forEach(currencies::put) })
            mapping.instrumentHint?.let { hint ->
                val validatedHint = hint.toCaptureInstrumentHintOrNull()
                    ?: throw IllegalArgumentException("The instrument hint is unsupported or unbounded.")
                value.put("instrumentHint", JSONObject()
                    .put("kind", validatedHint.kind)
                    .put("value", validatedHint.value))
            } ?: value.put("instrumentHint", JSONObject.NULL)
            mappings.put(value)
        }
        val body = JSONObject()
            .put("expectedRevision", config.expectedRevision)
            .put("mappings", mappings)
            .toString()
        return JSONObject(execute(
            MobileRequest(
                "PUT",
                "$origin/api/mobile/v1/devices/self/source-config",
                headers = mapOf("Accept" to "application/json", "Content-Type" to "application/json; charset=utf-8"),
                body = body.toByteArray(StandardCharsets.UTF_8),
            ),
        ).body).toMobileDevice()
    }

    /** Capture authorization also needs the encrypted credential hash and explicit consent.
     * The existing CaptureOnboardingCoordinator owns that boundary, so this adapter refuses
     * to manufacture a credential-shaped request from a source-only config. */
    override suspend fun authorizeCapture(config: DeviceSourceConfig): MobileDevice = throw UnsupportedOperationException(
        "Capture authorization requires the existing CaptureOnboardingCoordinator boundary.",
    )

    private suspend fun execute(request: MobileRequest): DeviceHttpResponse {
        val response = transport.execute(interceptor.intercept(request))
        if (response.statusCode in 200..299) return response
        if (response.statusCode == 409) {
            val current = runCatching { JSONObject(response.body).optInt("currentRevision", -1) }
                .getOrNull()
                ?.takeIf { it >= 0 }
            throw DeviceRevisionConflict(current)
        }
        throw when (response.statusCode) {
            401, 403 -> TransportFailure.Unauthorized
            404, 501 -> TransportFailure.Unavailable
            else -> TransportFailure.Retryable
        }
    }

    private fun encode(value: String): String = java.net.URLEncoder.encode(value, StandardCharsets.UTF_8.name()).replace("+", "%20")
}

/**
 * Converts the owner-authenticated device snapshot into capture choices only
 * when the mapping also matches a locally verified listener profile. The
 * server mapping alone is intentionally insufficient to activate capture.
 */
class DeviceCaptureProfileRepository(
    private val devices: DeviceManagementRepository,
    private val deviceId: String,
    private val localProfiles: CaptureSourceProfileProvider,
) : CaptureProfileRepository {
    init {
        require(deviceId.isNotBlank()) { "The capture device identity is required." }
    }

    override suspend fun load(): CaptureProfileLoadResult {
        val device = devices.readDevices().firstOrNull { it.id == deviceId }
            ?: return CaptureProfileLoadResult.Unavailable(CaptureProfileUnavailableReason.DeviceMappingUnavailable)
        if (device.revokedAt != null) {
            return CaptureProfileLoadResult.Unavailable(CaptureProfileUnavailableReason.DeviceRevoked)
        }
        if (device.status != "paired") {
            return CaptureProfileLoadResult.Unavailable(CaptureProfileUnavailableReason.DeviceNotPaired)
        }
        if (device.sourceMappings.isEmpty()) {
            return CaptureProfileLoadResult.Unavailable(CaptureProfileUnavailableReason.NoSourceMapping)
        }

        val approvedProfiles = localProfiles.approvedProfiles()
            .asSequence()
            .filter { it.approved && it.sourceKind == SourceProfileKind.BOC_CREDIT_CARD }
            .associateBy(SourceProfile::sourceProfileId)
        val mappedProfiles = device.sourceMappings.mapNotNull { mapping ->
            val local = approvedProfiles[mapping.sourceProfileId] ?: return@mapNotNull null
            val currencies = mapping.allowedCurrencies.distinct()
            if (currencies.isEmpty() || currencies.size != mapping.allowedCurrencies.size) return@mapNotNull null
            if (currencies.any { it !in local.allowedCurrencies }) return@mapNotNull null
            if (!local.instrumentHint.matches(mapping.instrumentHint)) return@mapNotNull null
            val instrumentHint = mapping.instrumentHint?.toCaptureInstrumentHintOrNull()
                ?: if (mapping.instrumentHint == null) null else return@mapNotNull null
            CaptureSourceProfile(
                sourceProfileId = local.sourceProfileId,
                displayName = local.displayName,
                accountId = mapping.accountId,
                instrumentLabel = mapping.instrumentHint?.let { "${it.kind}: ${it.value}" }
                    ?: local.instrumentHint?.let { "${it.kind.wireValue}: ${it.value}" }
                    ?: "Approved source mapping",
                currencies = currencies,
                instrumentHint = instrumentHint,
            )
        }
        if (mappedProfiles.size != device.sourceMappings.size) {
            return CaptureProfileLoadResult.Unavailable(CaptureProfileUnavailableReason.SourceProfileUnavailable)
        }
        val scopeKeys = mappedProfiles.flatMap { profile ->
            profile.currencies.map { currency ->
                listOf(profile.sourceProfileId, profile.accountId, currency, profile.instrumentHint?.kind, profile.instrumentHint?.value)
            }
        }
        if (scopeKeys.distinct().size != scopeKeys.size) {
            return CaptureProfileLoadResult.Unavailable(CaptureProfileUnavailableReason.MappingNotSupported)
        }
        return CaptureProfileLoadResult.Available(mappedProfiles, device.revision)
    }

    private fun com.lofuyu.borderledger.parser.InstrumentHint?.matches(hint: InstrumentHint?): Boolean = when {
        // A generic approved parser may be narrowed by an owner-approved
        // instrument mapping; a parser profile with its own hint must match it.
        this == null -> true
        hint == null -> false
        else -> kind.wireValue == hint.kind && value == hint.value
    }

}

private class UrlConnectionDeviceHttpTransport : DeviceHttpTransport {
    override suspend fun execute(request: MobileRequest): DeviceHttpResponse = withContext(Dispatchers.IO) {
        val connection = try {
            (URL(request.url).openConnection() as HttpURLConnection).apply {
                requestMethod = request.method
                connectTimeout = TIMEOUT_MILLIS
                readTimeout = TIMEOUT_MILLIS
                setRequestProperty("Accept", "application/json")
                setRequestProperty("Cache-Control", "no-store")
                request.headers.forEach { (name, value) -> setRequestProperty(name, value) }
                request.body?.let { body ->
                    doOutput = true
                    setFixedLengthStreamingMode(body.size)
                    outputStream.use { it.write(body) }
                }
            }
        } catch (_: IOException) {
            throw TransportFailure.Offline
        }
        try {
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            DeviceHttpResponse(
                statusCode = status,
                body = stream?.bufferedReader(StandardCharsets.UTF_8)?.use { it.readText() }.orEmpty(),
            )
        } catch (_: IOException) {
            throw TransportFailure.Offline
        } finally {
            connection.disconnect()
        }
    }

    private companion object { const val TIMEOUT_MILLIS = 15_000 }
}

private fun JSONArray?.toMobileDevices(): List<MobileDevice> = if (this == null) emptyList() else buildList(length()) {
    for (index in 0 until length()) {
        optJSONObject(index)?.let { add(it.toMobileDevice()) }
    }
}

private fun JSONObject.toMobileDevice(): MobileDevice {
    val sourceConfig = optJSONObject("sourceConfig")
    val expectedRevision = sourceConfig?.optInt("expectedRevision", optInt("revision", 0)) ?: optInt("revision", 0)
    return MobileDevice(
        id = getString("id"),
        name = getString("name"),
        platform = getString("platform"),
        status = getString("status"),
        credentialExpiresAt = optString("credentialExpiresAt").takeIf { it.isNotBlank() },
        revokedAt = optString("revokedAt").takeIf { it.isNotBlank() },
        sourceMappings = sourceConfig?.optJSONArray("mappings").toSourceMappings(),
        revision = optInt("revision", expectedRevision),
    )
}

private fun JSONArray?.toSourceMappings(): List<SourceMapping> = if (this == null) emptyList() else buildList(length()) {
    for (index in 0 until length()) {
        val value = optJSONObject(index) ?: continue
        val hint = value.optJSONObject("instrumentHint")?.let {
            InstrumentHint(it.getString("kind"), it.getString("value"))
        }
        add(
            SourceMapping(
                sourceProfileId = value.getString("sourceProfileId"),
                accountId = value.getString("accountId"),
                allowedCurrencies = value.optJSONArray("allowedCurrencies")?.toStrings().orEmpty(),
                instrumentHint = hint,
            ),
        )
    }
}

private fun JSONArray.toStrings(): List<String> = buildList(length()) {
    for (index in 0 until length()) add(getString(index))
}
