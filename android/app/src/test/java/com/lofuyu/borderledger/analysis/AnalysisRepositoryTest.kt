package com.lofuyu.borderledger.analysis
import com.lofuyu.borderledger.auth.MobileRequest
import com.lofuyu.borderledger.ownerCredentials
import com.lofuyu.borderledger.recurring.RecurringHttpResponse
import com.lofuyu.borderledger.recurring.RecurringHttpTransport
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test
class AnalysisRepositoryTest {
    @Test fun receiptOcrHasSeparateFixedRoutesAndBoundedImagePayloads() {
        assertEquals("GET" to "/api/mobile/v1/analysis/ocr/configuration",analysisRoute("ocr_settings","{}"))
        assertEquals("PUT" to "/api/mobile/v1/analysis/ocr/configuration",analysisRoute("ocr_configuration","{}"))
        assertEquals("DELETE" to "/api/mobile/v1/analysis/ocr/configuration",analysisRoute("ocr_remove","{}"))
        assertEquals("POST" to "/api/mobile/v1/analysis/ocr/scan",analysisRoute("ocr_scan","x".repeat(20000)))
        assertThrows(IllegalArgumentException::class.java) { analysisRoute("preview","x".repeat(20000)) }
        assertThrows(IllegalArgumentException::class.java) { analysisRoute("ocr_scan","x".repeat(6*1024*1024+1)) }
    }
    @Test fun requestsOnlyFixedRoutesWithOwnerAuthorization() = runTest {
        var request: MobileRequest? = null
        val api = HttpWorkerAnalysisApi("https://pf.example", "sandbox", ownerCredentials("owner-token"), RecurringHttpTransport {
            request=it; RecurringHttpResponse(200,"{}".encodeToByteArray())
        })
        api.execute("preview", "{}")
        assertEquals("POST",request?.method)
        assertEquals("https://pf.example/api/mobile/v1/analysis/preview",request?.url)
        assertEquals("Bearer owner-token",request?.headers?.get("Authorization"))
        assertThrows(IllegalArgumentException::class.java) { analysisRoute("../other", "{}") }
    }
}
