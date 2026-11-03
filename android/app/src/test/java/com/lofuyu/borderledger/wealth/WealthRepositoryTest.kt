package com.lofuyu.borderledger.wealth

import com.lofuyu.borderledger.auth.MobileRequest
import com.lofuyu.borderledger.ownerCredentials
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Test

class WealthRepositoryTest {
    @Test
    fun readUsesOwnerRouteAndKeepsMissingValuesInThePayload() = runTest {
        val requests = mutableListOf<MobileRequest>()
        val repository = repository(WealthHttpResponse(200, "{\"totalByCurrency\":{\"CAD\":null}}"), requests)

        val body = repository.readSnapshot(WealthReadQuery(view = "investments", accountId = "brokerage"))

        assertEquals("{\"totalByCurrency\":{\"CAD\":null}}", body)
        assertEquals("GET", requests.single().method)
        assertTrue(requests.single().url.startsWith("https://pf.example.com/api/mobile/owner/wealth/report?"))
        assertTrue(requests.single().url.contains("view=investments"))
        assertTrue(requests.single().url.contains("accountId=brokerage"))
    }

    @Test
    fun writeCarriesOperationAndActionThroughTheAuthenticatedRoute() = runTest {
        val requests = mutableListOf<MobileRequest>()
        val repository = repository(WealthHttpResponse(202, "{\"accepted\":true}"), requests)

        repository.write(WealthWriteCommand("op-1", "event", "{\"kind\":\"buy\"}"))

        assertEquals("POST", requests.single().method)
        assertEquals("/api/mobile/owner/wealth/events", java.net.URI(requests.single().url).path)
        val request = JSONObject(String(requireNotNull(requests.single().body)))
        assertEquals("op-1", request.getString("operationId"))
        assertEquals("buy", request.getJSONObject("event").getString("kind"))
    }

    @Test
    fun eventRevisionTravelsInTheRouteEnvelopeForConflictDetection() = runTest {
        val requests = mutableListOf<MobileRequest>()
        val repository = repository(WealthHttpResponse(202, "{}"), requests)

        repository.write(WealthWriteCommand("op-2", "event", "{\"kind\":\"contribution\",\"expectedRevision\":7}"))

        val request = JSONObject(String(requireNotNull(requests.single().body)))
        assertEquals(7, request.getInt("expectedRevision"))
        assertTrue(!request.getJSONObject("event").has("expectedRevision"))
    }

    @Test
    fun reportReadUsesServerReportRouteForHistoryAndPerformance() = runTest {
        val requests = mutableListOf<MobileRequest>()
        val repository = repository(WealthHttpResponse(200, "{}"), requests)

        repository.readSnapshot(WealthReadQuery(view = "cash-flow", periodStart = "2026-10-01", periodEnd = "2026-10-31"))

        assertEquals("/api/mobile/owner/wealth/report", java.net.URI(requests.single().url).path)
        assertTrue(requests.single().url.contains("from=2026-10-01"))
        assertTrue(requests.single().url.contains("to=2026-10-31"))
    }

    @Test
    fun investmentDetailReadsUseOwnerEventAndValuationRoutes() = runTest {
        val requests = mutableListOf<MobileRequest>()
        val repository = repository(WealthHttpResponse(200, "{}"), requests)

        repository.readEvents("brokerage")
        repository.readValuations("brokerage")

        assertEquals("/api/mobile/owner/wealth/events", java.net.URI(requests[0].url).path)
        assertEquals("brokerage", java.net.URI(requests[0].url).query.substringAfter("accountId="))
        assertEquals("/api/mobile/owner/wealth/valuations", java.net.URI(requests[1].url).path)
    }

    @Test
    fun quoteSettingsUseTheDedicatedWorkerRoutes() = runTest {
        val requests = mutableListOf<MobileRequest>()
        val repository = repository(WealthHttpResponse(200, "{}"), requests)

        repository.write(WealthWriteCommand("op-save", "quote-save", "{\"provider\":\"alpha_vantage\",\"credential\":\"secret\"}"))
        repository.write(WealthWriteCommand("op-remove", "quote-remove", "{\"provider\":\"alpha_vantage\"}"))
        repository.write(WealthWriteCommand("op-refresh", "quote-refresh", "{\"instrument\":{\"exchange\":\"TSX\",\"ticker\":\"SHOP\",\"type\":\"stock\",\"currency\":\"CAD\"}}"))

        assertEquals("PUT", requests[0].method)
        assertEquals("/api/mobile/owner/wealth/quotes/settings", java.net.URI(requests[0].url).path)
        assertEquals("DELETE", requests[1].method)
        assertEquals("alpha_vantage", java.net.URI(requests[1].url).query.substringAfter("provider="))
        assertEquals("POST", requests[2].method)
        assertEquals("/api/mobile/owner/wealth/quotes/refresh", java.net.URI(requests[2].url).path)
    }

    @Test
    fun quoteSettingsReadUsesTheDedicatedReadRoute() = runTest {
        val requests = mutableListOf<MobileRequest>()
        val repository = repository(WealthHttpResponse(200, "{\"providers\":[]}"), requests)

        repository.readQuoteSettings()

        assertEquals("GET", requests.single().method)
        assertEquals("/api/mobile/owner/wealth/quotes/settings", java.net.URI(requests.single().url).path)
    }

    @Test
    fun templateAndExportUseNativeAuthenticatedFileRoutes() = runTest {
        val requests = mutableListOf<MobileRequest>()
        val repository = repository(WealthHttpResponse(200, "csv"), requests)

        assertEquals("csv", repository.readTemplate())
        assertEquals("csv", repository.exportCsv())

        assertEquals("/api/mobile/owner/wealth/template", java.net.URI(requests[0].url).path)
        assertEquals("/api/mobile/owner/wealth/export", java.net.URI(requests[1].url).path)
    }

    @Test
    fun onlyReadAndWriteWealthScopesAreRegistered() {
        assertEquals(setOf("wealth:read", "wealth:write"), WealthScopeRegistry.all)
        assertEquals("wealth:read", WealthScopeRegistry.forMethod("GET"))
        assertEquals("wealth:write", WealthScopeRegistry.forMethod("POST"))
    }

    @Test
    fun legacyOwnerScopeFailureExplainsThatSignInIsRequired() = runTest {
        val repository = repository(WealthHttpResponse(403, "{}"))

        assertThrows(WealthAuthorizationRequired::class.java) { kotlinx.coroutines.runBlocking { repository.readSnapshot() } }
    }

    @Test
    fun rejectedWriteRetainsTheServerReasonForTheOwnerOperationReceipt() = runTest {
        val repository = repository(WealthHttpResponse(409, "{\"code\":\"account_mode_conflict\",\"message\":\"The transition date must be after all existing account history.\"}"))

        val error = assertThrows(WealthRevisionConflict::class.java) {
            kotlinx.coroutines.runBlocking { repository.write(WealthWriteCommand("op-guard", "account", "{\"id\":\"brokerage\"}")) }
        }

        assertNotNull(error.reason)
        assertEquals("The transition date must be after all existing account history.", error.reason)
    }

    private fun repository(response: WealthHttpResponse, requests: MutableList<MobileRequest> = mutableListOf()) = HttpWorkerWealthApi(
        origin = "https://pf.example.com", environment = "sandbox", credentials = ownerCredentials("owner-token"),
        transport = WealthHttpTransport { request -> requests += request; response },
    )
}
