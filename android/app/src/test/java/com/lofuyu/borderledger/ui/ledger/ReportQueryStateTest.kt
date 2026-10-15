package com.lofuyu.borderledger.ui.ledger

import java.time.DayOfWeek
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReportQueryStateTest {
    @Test
    fun onlyTheLatestRequestMayPublishResults() {
        val state = ReportQueryState()
        val first = state.begin(ReportQuerySpec(
            window = ReportWindow.Month,
            reportingCurrency = "CAD",
            reportingTimezone = "America/Toronto",
            weekStart = DayOfWeek.MONDAY,
            preferencesRevision = 1,
        ))
        val second = state.begin(ReportQuerySpec(
            window = ReportWindow.Week,
            reportingCurrency = "JPY",
            reportingTimezone = "Asia/Tokyo",
            weekStart = DayOfWeek.SUNDAY,
            preferencesRevision = 2,
        ))

        assertFalse(state.isCurrent(first.id))
        assertTrue(state.isCurrent(second.id))
        assertTrue(state.current()?.spec?.reportingCurrency == "JPY")
    }

    @Test
    fun dateWindowsHonorTheSelectedWeekStart() {
        val sunday = java.time.LocalDate.parse("2026-10-18")
        assertTrue(reportDateWindow(ReportWindow.Week, sunday, DayOfWeek.SUNDAY).startDate == sunday)
        assertTrue(reportDateWindow(ReportWindow.Week, sunday, DayOfWeek.MONDAY).startDate == java.time.LocalDate.parse("2026-10-12"))
    }
}
