package com.lofuyu.borderledger.budget

import com.lofuyu.borderledger.auth.MobileRequest
import com.lofuyu.borderledger.ownerCredentials
import com.lofuyu.borderledger.recurring.RecurringHttpResponse
import com.lofuyu.borderledger.recurring.RecurringHttpTransport
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class BudgetRepositoryTest {
    @Test fun viewUsesOwnerCredentialAndFixedRoute() = runTest {
        var request: MobileRequest? = null
        val api = HttpWorkerBudgetApi("https://pf.example", "sandbox", ownerCredentials("owner-token"), RecurringHttpTransport {
            request = it
            RecurringHttpResponse(200, "{}".encodeToByteArray())
        })
        assertEquals("{}", api.readView("2026-10"))
        assertEquals("https://pf.example/api/mobile/v1/budget/view?month=2026-10", request?.url)
        assertEquals("Bearer owner-token", request?.headers?.get("Authorization"))
    }
    @Test fun onlyAllowlistedWriteActionsAreAccepted() {
        assertThrows(IllegalArgumentException::class.java) { budgetWritePath("../session", "{}") }
        assertThrows(IllegalArgumentException::class.java) { budgetWritePath("cash-delete", "{\"id\":\"../foo\"}") }
        assertEquals("/api/mobile/v1/budget/allocations", budgetWritePath("allocations", "{}"))
    }
    @Test fun writeUsesFixedRouteAndOwnerCredential() = runTest {
        var request: MobileRequest? = null
        val api = HttpWorkerBudgetApi("https://pf.example", "sandbox", ownerCredentials("owner-token"), RecurringHttpTransport {
            request = it
            RecurringHttpResponse(200, "{\"ok\":true}".encodeToByteArray())
        })
        api.write("settings", "{\"currency\":\"CAD\"}")
        assertEquals("PUT", request?.method)
        assertEquals("https://pf.example/api/mobile/v1/budget/settings", request?.url)
        assertEquals("Bearer owner-token", request?.headers?.get("Authorization"))
    }
}
