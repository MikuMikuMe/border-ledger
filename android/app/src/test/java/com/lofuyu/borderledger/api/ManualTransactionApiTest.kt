package com.lofuyu.borderledger.api

import com.lofuyu.borderledger.auth.MobileRequest
import com.lofuyu.borderledger.ownerCredentials
import com.lofuyu.borderledger.recurring.RecurringHttpResponse
import com.lofuyu.borderledger.recurring.RecurringHttpTransport
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.json.JSONObject

class ManualTransactionApiTest {
    @Test fun routesAreFixedAndOwnerAuthenticated() = runTest {
        val requests = mutableListOf<MobileRequest>()
        val api = ManualTransactionApi("https://pf.example", "sandbox", ownerCredentials("owner-token"), RecurringHttpTransport {
            requests.add(it)
            RecurringHttpResponse(200, "{}".encodeToByteArray())
        })
        api.categoryAction("preview", "{}")
        api.categoryAction("restore", "{}")
        api.categories()
        api.createCategory("Food")
        api.matches(200)
        api.write("create", "{}")
        api.write("match", "{}")
        assertEquals(listOf("https://pf.example/api/mobile/v1/categories/preview", "https://pf.example/api/mobile/v1/categories/restore", "https://pf.example/api/mobile/v1/categories", "https://pf.example/api/mobile/v1/categories", "https://pf.example/api/mobile/v1/transactions/manual-matches?offset=200", "https://pf.example/api/mobile/v1/transactions", "https://pf.example/api/mobile/v1/transactions/manual-matches"), requests.map { it.url })
        assertTrue(requests.all { it.headers["Authorization"] == "Bearer owner-token" })
        assertTrue(runCatching { api.categoryAction("../session", "{}") }.isFailure)
        assertTrue(runCatching { api.write("../session", "{}") }.isFailure)
    }
    @Test fun transactionMutationsUseEncodedOwnerRoutes() = runTest {
        val requests = mutableListOf<MobileRequest>()
        val api = ManualTransactionApi("https://pf.example", "sandbox", ownerCredentials("owner-token"), RecurringHttpTransport {
            requests.add(it)
            RecurringHttpResponse(200, "{}".encodeToByteArray())
        })
        api.deleted()
        for (action in listOf("edit", "delete", "restore")) api.write(action, """{"transactionId":"tx-1","requestId":"operation-123456"}""")
        assertEquals(listOf("https://pf.example/api/mobile/v1/transactions/deleted", "https://pf.example/api/mobile/v1/transactions/by-id/edit", "https://pf.example/api/mobile/v1/transactions/by-id/delete", "https://pf.example/api/mobile/v1/transactions/by-id/restore"), requests.map { it.url })
        assertTrue(requests.all { it.headers["Authorization"] == "Bearer owner-token" })
        api.write("edit", JSONObject().put("transactionId", "a".repeat(158) + "/b").toString())
        assertEquals("https://pf.example/api/mobile/v1/transactions/by-id/edit", requests.last().url)
        api.write("edit", """{"transactionId":"../auth"}""")
        assertEquals("https://pf.example/api/mobile/v1/transactions/by-id/edit", requests.last().url)
    }

}
