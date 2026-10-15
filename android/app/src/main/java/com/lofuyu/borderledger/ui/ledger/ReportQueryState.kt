package com.lofuyu.borderledger.ui.ledger

import java.time.DayOfWeek
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

/** Immutable inputs that define one server report request. */
data class ReportQuerySpec(
    val window: ReportWindow,
    val includeProvisional: Boolean = false,
    val sourceCurrency: String? = null,
    val reportingCurrency: String? = null,
    val reportingTimezone: String = "America/Toronto",
    val weekStart: DayOfWeek = DayOfWeek.MONDAY,
    val preferencesRevision: Int = 0,
)

data class ReportQueryHandle(
    val id: Long,
    val spec: ReportQuerySpec,
)

/**
 * Small concurrency boundary for Compose report loading.
 *
 * Network responses may return out of order when a user changes the window,
 * source currency, or reporting currency quickly. Only the newest handle can
 * publish data or an error into the screen.
 */
class ReportQueryState {
    private val nextId = AtomicLong(0)
    private val currentRequest = AtomicReference<ReportQueryHandle?>(null)

    fun begin(spec: ReportQuerySpec): ReportQueryHandle {
        require(spec.reportingTimezone.isNotBlank())
        require(spec.preferencesRevision >= 0)
        return ReportQueryHandle(nextId.incrementAndGet(), spec).also(currentRequest::set)
    }

    fun isCurrent(id: Long): Boolean = currentRequest.get()?.id == id

    fun isCurrent(handle: ReportQueryHandle): Boolean = isCurrent(handle.id)

    fun current(): ReportQueryHandle? = currentRequest.get()

    fun hasSameSpec(spec: ReportQuerySpec): Boolean = current()?.spec == spec

    fun clear(handle: ReportQueryHandle): Boolean = currentRequest.compareAndSet(handle, null)
}

fun preferenceWeekStart(value: Int): DayOfWeek = when (value) {
    0 -> DayOfWeek.SUNDAY
    in 1..6 -> DayOfWeek.of(value)
    else -> DayOfWeek.MONDAY
}

