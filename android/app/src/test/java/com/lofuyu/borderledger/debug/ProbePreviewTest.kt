package com.lofuyu.borderledger.debug

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId

class ProbePreviewTest {
    @Test fun previewKeepsOnlyBoundedMetadataAndNeverCopiesPrivateText() {
        val secret = "SYNTHETIC_SECRET_TEXT"
        val preview = requireNotNull(ProbePreview.from(
            packageName = "com.tencent.mm",
            postTime = 1_700_000_000_000L,
            callbackTime = 1_700_000_000_100L,
            title = secret,
            body = secret,
            category = "msg",
        ))

        assertEquals("com.tencent.mm", preview.sourcePackage)
        assertTrue(preview.titlePresent)
        assertTrue(preview.bodyPresent)
        assertFalse(preview.toString().contains(secret))
        assertFalse(preview.sanitizedCsvRow().contains(secret))
        assertEquals(1_700_000_000_000L, preview.notificationPostedAt)
    }

    @Test fun unapprovedPackagesAndInvalidTimestampsAreRejected() {
        assertEquals(null, ProbePreview.from("other.app", 1L, 2L, "x", "y", null))
        assertEquals(null, ProbePreview.from("com.tencent.mm", 0L, 2L, "x", "y", null))
    }

    @Test fun previewKeepsBoundedRepresentationsAndLabelsRecoveredRowsWithoutRawText() {
        val secret = "SYNTHETIC_PRIVATE_MESSAGE"
        val preview = requireNotNull(ProbePreview.from(
            packageName = "com.tencent.mm",
            postTime = 1_700_000_000_000L,
            callbackTime = 1_700_000_000_100L,
            title = secret,
            body = secret,
            category = "msg",
            representations = NotificationRepresentationSummary(
                standardTextPresent = true,
                bigTextPresent = true,
                textLineCount = 3,
                messagingRepresentationPresent = true,
                messagingMessageCount = 3,
                individualTimestampCount = 3,
                individualTimestampMin = 1_699_999_900_000L,
                individualTimestampMax = 1_700_000_000_000L,
            ),
            observationKind = ProbeObservationKind.RECOVERED_ACTIVE,
        ))

        assertEquals(ProbeSourceIdentification.PACKAGE_ONLY, preview.sourceIdentification)
        assertEquals(ProbeObservationKind.RECOVERED_ACTIVE, preview.observationKind)
        assertTrue(preview.representations.bigTextPresent)
        assertEquals(3, preview.representations.messagingMessageCount)
        assertEquals(3, preview.representations.individualTimestampCount)
        assertEquals(1_699_999_900_000L, preview.representations.individualTimestampMin)
        assertEquals(1_700_000_000_000L, preview.representations.individualTimestampMax)
        assertFalse(preview.sanitizedCsvRow().contains(secret))
    }

    @Test fun timeSummaryShowsDeviceZoneAndTorontoReportingDay() {
        val summary = ProbeTimeSummary.from(
            epochMillis = Instant.parse("2026-10-13T04:00:00Z").toEpochMilli(),
            deviceZone = ZoneId.of("Asia/Shanghai"),
        )

        assertEquals("Asia/Shanghai", summary.deviceZone)
        assertEquals("2026-10-13 12:00:00 +08:00", summary.deviceTime)
        assertEquals("2026-10-13", summary.torontoReportingDay)
    }

    @Test fun representationCountsAreCappedBeforeRetention() {
        val preview = requireNotNull(ProbePreview.from(
            packageName = "com.tencent.mm",
            postTime = 1_700_000_000_000L,
            callbackTime = 1_700_000_000_100L,
            title = null,
            body = null,
            category = null,
            representations = NotificationRepresentationSummary(
                textLineCount = 21,
                messagingMessageCount = 21,
                messagingRepresentationPresent = true,
                messagingMessagesTruncated = true,
                individualTimestampCount = 21,
                individualTimestampMin = 1L,
                individualTimestampMax = 2L,
            ),
        ))

        assertEquals(20, preview.representations.textLineCount)
        assertTrue(preview.representations.textLinesTruncated)
        assertEquals(20, preview.representations.messagingMessageCount)
        assertTrue(preview.representations.messagingMessagesTruncated)
        assertEquals(20, preview.representations.individualTimestampCount)
    }
}
