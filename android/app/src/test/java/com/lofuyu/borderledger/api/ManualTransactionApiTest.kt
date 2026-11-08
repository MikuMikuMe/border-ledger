package com.lofuyu.borderledger.api

import com.lofuyu.borderledger.auth.MobileRequest
import com.lofuyu.borderledger.ownerCredentials
import com.lofuyu.borderledger.recurring.RecurringHttpResponse
import com.lofuyu.borderledger.recurring.RecurringHttpTransport
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ManualTransactionApiTest {
    @Test fun routesAreFixedAndOwnerAuthenticated() = runTest {
        val requests = mutableListOf<MobileRequest>()
        val api = ManualTransactionApi("https://pf.example", "sandbox", ownerCredentials("owner-token"), RecurringHttpTransport {
            requests.add(it)
            RecurringHttpResponse(200, "{}".encodeToByteArray())
        })
        api.matches(200)
        api.write("create", "{}")
        api.write("match", "{}")
        assertEquals(listOf("https://pf.example/api/mobile/v1/transactions/manual-matches?offset=200", "https://pf.example/api/mobile/v1/transactions", "https://pf.example/api/mobile/v1/transactions/manual-matches"), requests.map { it.url })
        assertTrue(requests.all { it.headers["Authorization"] == "Bearer owner-token" })
        assertTrue(runCatching { api.write("../session", "{}") }.isFailure)
    }
}
