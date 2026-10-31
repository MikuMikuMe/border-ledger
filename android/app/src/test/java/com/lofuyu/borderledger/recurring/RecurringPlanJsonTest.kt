package com.lofuyu.borderledger.recurring

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RecurringPlanJsonTest {
    @Test fun readsExactAmountsAndOccurrenceStates() {
        val plans = RecurringPlanJson.decodePlans("""{"plans":[{"id":"p","accountId":"a","currency":"CAD","merchant":"Transit","direction":"expense","amountMinor":1250,"frequency":"monthly","startDate":"2026-01-31","endDate":null,"enabled":true,"revision":0}]}""".encodeToByteArray())
        assertEquals(1250L, plans.single().amountMinor)
        val occurrences = RecurringPlanJson.decodeOccurrences("""{"occurrences":[{"planId":"p","date":"2026-02-28","status":"not_assessable","candidateIds":[],"candidateCount":0,"candidateDetails":[]}]}""".encodeToByteArray())
        assertEquals("not_assessable", occurrences.single().status)
    }
    @Test fun rejectsUnsafeAmountsAndUnknownStates() {
        assertTrue(runCatching { RecurringPlanJson.decodeOccurrences("""{"occurrences":[{"planId":"p","date":"2026-02-28","status":"paid","candidateIds":[],"candidateCount":0,"candidateDetails":[]}]}""".encodeToByteArray()) }.isFailure)
        assertTrue(runCatching { RecurringPlanJson.decodePlans("""{"plans":[{"id":"p","accountId":"a","currency":"CAD","merchant":"x","direction":"expense","amountMinor":9007199254740992,"frequency":"monthly","startDate":"2026-01-01","endDate":null,"enabled":true,"revision":0}]}""".encodeToByteArray()) }.isFailure)
    }    @Test fun rejectsDefinitivePlanWriteErrorsWithoutUncertainReceipt() {
        assertTrue(runCatching { planWriteResponse(403, byteArrayOf()) }.exceptionOrNull() is RecurringPlanRejected)
        assertTrue(runCatching { planWriteResponse(400, byteArrayOf()) }.exceptionOrNull() is RecurringPlanRejected)
        val conflict = runCatching { planWriteResponse(409, """{"currentRevision":4}""".encodeToByteArray()) }.exceptionOrNull() as RecurringRevisionConflict
        assertEquals(4, conflict.currentRevision)
    }

}
