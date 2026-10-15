package com.lofuyu.borderledger.debug

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

data class ProbeTimeSummary(
    val deviceZone: String,
    val deviceTime: String,
    val torontoReportingDay: String,
) {
    companion object {
        private val deviceFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss XXX")
        private val torontoDayFormatter = DateTimeFormatter.ISO_LOCAL_DATE
        private val torontoZone = ZoneId.of("America/Toronto")

        fun from(epochMillis: Long, deviceZone: ZoneId): ProbeTimeSummary {
            val instant = Instant.ofEpochMilli(epochMillis)
            return ProbeTimeSummary(
                deviceZone = deviceZone.id,
                deviceTime = deviceFormatter.withZone(deviceZone).format(instant),
                torontoReportingDay = torontoDayFormatter.withZone(torontoZone).format(instant),
            )
        }
    }
}
