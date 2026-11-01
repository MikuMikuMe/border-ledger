package com.lofuyu.borderledger.budget

import com.lofuyu.borderledger.auth.MobileRequest
import com.lofuyu.borderledger.ownerCredentials
import com.lofuyu.borderledger.recurring.RecurringHttpResponse
import com.lofuyu.borderledger.recurring.RecurringHttpTransport
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

private class BudgetApiFixture(response: RecurringHttpResponse = RecurringHttpResponse(200, "{}".encodeToByteArray())) {
    val requests = mutableListOf<MobileRequest>()
    val api = HttpWorkerBudgetApi("https://pf.example", "sandbox", ownerCredentials("owner-token"), RecurringHttpTransport {
        requests.add(it)
        response
    })
    val request: MobileRequest? get() = requests.lastOrNull()
}

class BudgetRepositoryTest {
    @Test fun modeAndPreviewReadsUseFixedValidatedRoutes() = runTest {
        val fixture = BudgetApiFixture()
        fixture.api.readModeView(BudgetModeViewRequest(BudgetMonth("2026-10"), "tracking"))
        fixture.api.readCopyPreview(BudgetMonth("2026-10"))
        fixture.api.readRolloverPreview(BudgetRolloverRequest("Food & dining", BudgetMonth("2026-10"), "reset"))
        assertEquals(listOf("https://pf.example/api/mobile/v1/budget/view?month=2026-10&mode=tracking", "https://pf.example/api/mobile/v1/budget/tracking-copy?month=2026-10", "https://pf.example/api/mobile/v1/budget/rollover-preview?category=Food+%26+dining&effectiveMonth=2026-10&policy=reset"), fixture.requests.map { it.url })
    }
    @Test fun guardedWritesAreAllowlisted() {
        for (action in listOf("mode", "tracking-plans", "tracking-copy", "rollover")) {
            assertEquals("/api/mobile/v1/budget/$action", budgetWritePath(action, "{}"))
        }
    }
    @Test fun previewAcceptsTheSameCategoryLimitAsTheApi() = runTest {
        val fixture = BudgetApiFixture()
        fixture.api.readRolloverPreview(BudgetRolloverRequest("x".repeat(120), BudgetMonth("2026-10"), "carry_positive"))
        assertEquals(1, fixture.requests.size)
    }
    @Test fun routingRequestsRejectInvalidMonthsModesAndPolicies() {
        assertThrows(IllegalArgumentException::class.java) { BudgetMonth("2026-13") }
        assertThrows(IllegalArgumentException::class.java) { BudgetMonth("2026-10&mode=tracking") }
        assertThrows(IllegalArgumentException::class.java) { BudgetModeViewRequest(BudgetMonth("2026-10"), "../settings") }
        assertThrows(IllegalArgumentException::class.java) { BudgetRolloverRequest("x".repeat(121), BudgetMonth("2026-10"), "reset") }
        assertThrows(IllegalArgumentException::class.java) { BudgetRolloverRequest("Food", BudgetMonth("2026-10"), "invalid") }
    }
    @Test fun confirmedHttpConflictIsDistinctFromAnAmbiguousTransportFailure() = runTest {
        val fixture = BudgetApiFixture(RecurringHttpResponse(409, "{\"code\":\"budget_conflict\"}".encodeToByteArray()))
        val error = runCatching { fixture.api.write(BudgetWriteCommand("tracking-plans", "{}")) }.exceptionOrNull()
        assertEquals(BudgetRevisionConflict::class.java, error?.javaClass)
    }
    @Test fun viewUsesOwnerCredentialAndFixedRoute() = runTest {
        val fixture = BudgetApiFixture()
        assertEquals("{}", fixture.api.readView("2026-10"))
        assertEquals("https://pf.example/api/mobile/v1/budget/view?month=2026-10", fixture.request?.url)
        assertEquals("Bearer owner-token", fixture.request?.headers?.get("Authorization"))
    }
    @Test fun onlyAllowlistedWriteActionsAreAccepted() {
        assertThrows(IllegalArgumentException::class.java) { budgetWritePath("../session", "{}") }
        assertThrows(IllegalArgumentException::class.java) { budgetWritePath("cash-delete", "{\"id\":\"../foo\"}") }
        assertEquals("/api/mobile/v1/budget/allocations", budgetWritePath("allocations", "{}"))
    }
    @Test fun writeUsesFixedRouteAndOwnerCredential() = runTest {
        val fixture = BudgetApiFixture()
        fixture.api.write(BudgetWriteCommand("settings", "{\"currency\":\"CAD\"}"))
        assertEquals("PUT", fixture.request?.method)
        assertEquals("https://pf.example/api/mobile/v1/budget/settings", fixture.request?.url)
        assertEquals("Bearer owner-token", fixture.request?.headers?.get("Authorization"))
    }
}
