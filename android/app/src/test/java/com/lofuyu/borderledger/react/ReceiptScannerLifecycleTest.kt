package com.lofuyu.borderledger.react

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Regression coverage for scanner cancellation, invalidation, and late callbacks. */
class ReceiptScannerLifecycleTest {
    @Test fun duplicateScannerResultDoesNotReplaceTheImageBeingProcessed() {
        val deleted = mutableListOf<String>()
        var calls = 0
        val lifecycle = ReceiptScanLifecycle<String>(deleted::add) {}
        val request = recordingRequest()
        assertTrue(lifecycle.begin(request.request))
        lifecycle.handleActivityResult(true, listOf("first")) { _, _ -> calls++ }
        lifecycle.handleActivityResult(true, listOf("first", "duplicate")) { _, _ -> calls++ }
        assertEquals(1, calls)
        assertEquals(listOf("duplicate"), deleted)
        lifecycle.completeOcr(request.request, "text")
        lifecycle.finishOcr(request.request)
        assertEquals(listOf("duplicate", "first"), deleted)
    }
    @Test
    fun lateActivityResultAfterInvalidationCleansEveryPageWithoutSettlingAgain() {
        val deleted = mutableListOf<String>()
        var removedListeners = 0
        var processCalls = 0
        val lifecycle = ReceiptScanLifecycle<String>(deleted::add) { removedListeners++ }
        val request = recordingRequest()

        assertTrue(lifecycle.begin(request.request))
        lifecycle.invalidate()
        lifecycle.handleActivityResult(true, listOf("page-1", "page-2")) { _, _ -> processCalls++ }

        assertEquals(listOf("interrupted"), request.rejections.map { it.first })
        assertTrue(request.resolutions.isEmpty())
        assertEquals(listOf("page-1", "page-2"), deleted)
        assertEquals(1, removedListeners)
        assertEquals(0, processCalls)

        // A duplicate late callback remains harmless and is still cleaned up.
        lifecycle.handleActivityResult(true, listOf("duplicate-page")) { _, _ -> processCalls++ }
        assertEquals(listOf("page-1", "page-2", "duplicate-page"), deleted)
        assertEquals(listOf("interrupted"), request.rejections.map { it.first })
        assertEquals(0, processCalls)
    }

    @Test
    fun invalidationDuringOcrRejectsOnceAndCompletionStillCleansTheImage() {
        val deleted = mutableListOf<String>()
        var removedListeners = 0
        var ocrRequest: ReceiptScanRequest? = null
        var ocrUri: String? = null
        val lifecycle = ReceiptScanLifecycle<String>(deleted::add) { removedListeners++ }
        val request = recordingRequest()

        assertTrue(lifecycle.begin(request.request))
        lifecycle.handleActivityResult(true, listOf("ocr-page")) { callbackRequest, uri ->
            ocrRequest = callbackRequest
            ocrUri = uri
        }
        lifecycle.invalidate()

        assertEquals(request.request, ocrRequest)
        assertEquals("ocr-page", ocrUri)
        assertEquals(listOf("interrupted"), request.rejections.map { it.first })
        assertEquals(1, removedListeners)

        // ML Kit may deliver callbacks after React invalidates the module.
        lifecycle.completeOcr(request.request, "late OCR text")
        lifecycle.failOcr(request.request)
        lifecycle.finishOcr(request.request)
        lifecycle.finishOcr(request.request)

        assertTrue(request.resolutions.isEmpty())
        assertEquals(listOf("interrupted"), request.rejections.map { it.first })
        assertEquals(listOf("ocr-page"), deleted)
    }

    @Test
    fun canceledScanResolvesNullAndDeletesReturnedPages() {
        val deleted = mutableListOf<String>()
        var removedListeners = 0
        val lifecycle = ReceiptScanLifecycle<String>(deleted::add) { removedListeners++ }
        val request = recordingRequest()

        assertTrue(lifecycle.begin(request.request))
        lifecycle.handleActivityResult(false, listOf("cancel-page", "extra-page")) { _, _ ->
            throw AssertionError("A canceled scan must not start OCR")
        }

        assertEquals(listOf(null), request.resolutions)
        assertTrue(request.rejections.isEmpty())
        assertEquals(listOf("cancel-page", "extra-page"), deleted)
        assertEquals(0, removedListeners)
    }

    @Test
    fun duplicateOcrCallbacksSettleOnceAndDeleteTheImageOnce() {
        val deleted = mutableListOf<String>()
        val lifecycle = ReceiptScanLifecycle<String>(deleted::add) {}
        val request = recordingRequest()

        assertTrue(lifecycle.begin(request.request))
        lifecycle.handleActivityResult(true, listOf("ocr-page")) { _, _ -> }
        lifecycle.completeOcr(request.request, "first text")
        lifecycle.completeOcr(request.request, "second text")
        lifecycle.failOcr(request.request)
        lifecycle.finishOcr(request.request)
        lifecycle.finishOcr(request.request)

        assertEquals(listOf("first text"), request.resolutions)
        assertTrue(request.rejections.isEmpty())
        assertEquals(listOf("ocr-page"), deleted)
    }

    @Test
    fun newScanWaitsForPriorOcrCleanupAfterItsPromiseSettles() {
        val deleted = mutableListOf<String>()
        val lifecycle = ReceiptScanLifecycle<String>(deleted::add) {}
        val first = recordingRequest()
        val second = recordingRequest()

        assertTrue(lifecycle.begin(first.request))
        lifecycle.handleActivityResult(true, listOf("first-page")) { _, _ -> }
        lifecycle.completeOcr(first.request, "first text")

        // The JS promise is settled, but ML Kit has not run its completion cleanup yet.
        assertFalse(lifecycle.begin(second.request))
        lifecycle.finishOcr(first.request)

        assertTrue(lifecycle.begin(second.request))
        lifecycle.handleActivityResult(true, listOf("second-page")) { _, _ -> }
        lifecycle.failOcr(second.request)
        lifecycle.finishOcr(second.request)

        assertEquals(listOf("first-page", "second-page"), deleted)
        assertEquals(listOf("first text"), first.resolutions)
        assertEquals(listOf("scan_failed"), second.rejections.map { it.first })
    }

    @Test
    fun startIntentCompletionAfterInvalidationDoesNotLaunchOrDoubleReject() {
        var launches = 0
        var removedListeners = 0
        val lifecycle = ReceiptScanLifecycle<String>({}, { removedListeners++ })
        val request = recordingRequest()

        assertTrue(lifecycle.begin(request.request))
        lifecycle.invalidate()
        lifecycle.handleStartSuccess(request.request) { launches++ }
        lifecycle.handleStartFailure(request.request)

        assertEquals(0, launches)
        assertEquals(listOf("interrupted"), request.rejections.map { it.first })
        assertEquals(1, removedListeners)
        assertFalse(request.resolutions.isNotEmpty())
    }

    private fun recordingRequest(): RecordedRequest {
        lateinit var recorded: RecordedRequest
        val request = ReceiptScanRequest(
            resolve = { value -> recorded.resolutions += value },
            reject = { code, message -> recorded.rejections += code to message },
        )
        recorded = RecordedRequest(request)
        return recorded
    }

    private class RecordedRequest(val request: ReceiptScanRequest) {
        val resolutions = mutableListOf<String?>()
        val rejections = mutableListOf<Pair<String, String>>()
    }
}
