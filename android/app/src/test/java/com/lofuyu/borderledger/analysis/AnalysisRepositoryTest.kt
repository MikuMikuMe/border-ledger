package com.lofuyu.borderledger.analysis
import com.lofuyu.borderledger.auth.MobileRequest
import com.lofuyu.borderledger.ownerCredentials
import com.lofuyu.borderledger.recurring.RecurringHttpResponse
import com.lofuyu.borderledger.recurring.RecurringHttpTransport
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test
class AnalysisRepositoryTest {
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
