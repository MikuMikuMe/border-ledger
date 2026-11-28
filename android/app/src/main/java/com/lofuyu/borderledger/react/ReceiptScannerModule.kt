package com.lofuyu.borderledger.react

import android.app.Activity
import android.content.Intent
import android.net.Uri
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.util.Base64
import org.json.JSONObject

internal fun receiptImageBase64(input: InputStream, limit: Int): String {
    val output = ByteArrayOutputStream()
    val buffer = ByteArray(8192)
    while (true) {
        val count = input.read(buffer)
        if (count < 0) break
        require(output.size() + count <= limit)
        output.write(buffer, 0, count)
    }
    return Base64.getEncoder().encodeToString(output.toByteArray())
}

class ReceiptScannerModule(private val context: ReactApplicationContext): ReactContextBaseJavaModule(context) {
    private inner class ReceiptActivityListener: BaseActivityEventListener() {
        override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
            handleActivityResult(requestCode, resultCode, data)
        }
    }

    private val listener: BaseActivityEventListener = ReceiptActivityListener()
    private val lifecycle = ReceiptScanLifecycle<Uri>(
        deleteScan = ::deleteScan,
        removeListener = { context.removeActivityEventListener(listener) },
    )

    private fun handleActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQUEST_CODE) return
        val result = GmsDocumentScanningResult.fromActivityResultIntent(data)
        val pages = result?.pages.orEmpty().map { page -> page.imageUri }
        lifecycle.handleActivityResult(resultCode == Activity.RESULT_OK, pages, ::processReceipt)
    }

    private fun processReceipt(request: ReceiptScanRequest, uri: Uri) {
        val image = try { InputImage.fromFilePath(context, uri) } catch (_: Exception) {
            lifecycle.failImmediately(request, uri)
            return
        }
        val recognizer = try { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) } catch (_: Exception) {
            lifecycle.failImmediately(request, uri)
            return
        }
        try {
            recognizer.process(image)
                .addOnSuccessListener { result ->
                    val lines = receiptLines(result)
                    val text = receiptTextInReadingOrder(lines, result.text)
                    try { lifecycle.completeOcr(request, receiptPayload(request, uri, text)) }
                    catch (_: Exception) { lifecycle.failOcr(request) }
                }
                .addOnFailureListener { lifecycle.failOcr(request) }
                .addOnCompleteListener { recognizer.close(); lifecycle.finishOcr(request) }
        } catch (_: Exception) {
            recognizer.close()
            lifecycle.failImmediately(request, uri)
        }
    }

    private fun receiptLines(result: Text): List<ReceiptTextLine> = result.textBlocks.flatMap { it.lines }.map { line ->
        val box = line.boundingBox
        ReceiptTextLine(line.text, box?.left ?: 0, box?.top ?: 0, box?.right ?: 0, box?.bottom ?: 0)
    }

    private fun receiptPayload(request: ReceiptScanRequest, uri: Uri, text: String): String {
        if (!request.includeImage) return text
        val encoded = requireNotNull(context.contentResolver.openInputStream(uri)).use { receiptImageBase64(it, 5 * 1024 * 1024 * 3 / 4) }
        return JSONObject().put("text", text).put("image", encoded).put("contentType", "image/jpeg").toString()
    }

    private fun rejectUnavailable(promise: Promise) {
        promise.reject("unavailable", "Receipt scanner is unavailable.")
    }

    private fun startScan(activity: Activity, request: ReceiptScanRequest) {
        val options = GmsDocumentScannerOptions.Builder().setGalleryImportAllowed(true).setPageLimit(1)
            .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
            .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL).build()
        GmsDocumentScanning.getClient(options).getStartScanIntent(activity)
            .addOnSuccessListener { sender ->
                lifecycle.handleStartSuccess(request) {
                    activity.startIntentSenderForResult(sender, REQUEST_CODE, null, 0, 0, 0)
                }
            }
            .addOnFailureListener { lifecycle.handleStartFailure(request) }
    }

    private fun deleteScan(uri: Uri) {
        runCatching {
            if (uri.scheme == "file") {
                val file = java.io.File(requireNotNull(uri.path)).canonicalFile
                if (file.toPath().startsWith(context.cacheDir.canonicalFile.toPath())) file.delete()
            } else if (uri.scheme == "content") context.contentResolver.delete(uri, null, null)
        }
    }

    init { context.addActivityEventListener(listener) }

    override fun getName() = "NativeReceiptScanner"

    override fun invalidate() {
        lifecycle.invalidate()
        super.invalidate()
    }

    @ReactMethod fun scan(promise: Promise) = beginScan(promise, false)
    @ReactMethod fun scanForCloud(promise: Promise) = beginScan(promise, true)

    private fun beginScan(promise: Promise, includeImage: Boolean) {
        UiThreadUtil.runOnUiThread {
            val activity = context.currentActivity
            if (lifecycle.isInvalidated()) { rejectUnavailable(promise); return@runOnUiThread }
            if (activity == null) { rejectUnavailable(promise); return@runOnUiThread }
            val request = ReceiptScanRequest(
                resolve = { value -> promise.resolve(value) },
                reject = { code, message -> promise.reject(code, message) },
                includeImage = includeImage,
            )
            if (!lifecycle.begin(request)) { rejectUnavailable(promise); return@runOnUiThread }
            startScan(activity, request)
        }
    }

    private companion object {
        const val REQUEST_CODE = 47281
    }
}

internal class ReceiptScanRequest(
    val resolve: (String?) -> Unit,
    val reject: (String, String) -> Unit,
    val includeImage: Boolean = false,
)

/**
 * Owns scanner and OCR completion state independently from Android and ML Kit.
 * This keeps invalidation and late-result behavior deterministic and testable.
 */
internal class ReceiptScanLifecycle<T>(
    private val deleteScan: (T) -> Unit,
    private val removeListener: () -> Unit,
) {
    private var pending: ReceiptScanRequest? = null
    private var ocrRequest: ReceiptScanRequest? = null
    private var ocrUri: T? = null
    private var invalidated = false
    private var scannerPending = false
    private var listenerRegistered = true

    @Synchronized
    fun isInvalidated() = invalidated

    @Synchronized
    fun begin(request: ReceiptScanRequest): Boolean {
        if (invalidated) return false
        if (pending != null) return false
        if (ocrRequest != null) return false
        pending = request
        scannerPending = true
        return true
    }

    @Synchronized
    fun handleActivityResult(
        success: Boolean,
        pages: List<T>,
        process: (ReceiptScanRequest, T) -> Unit,
    ) {
        scannerPending = false
        if (ocrRequest != null) {
            pages.filter { it != ocrUri }.forEach(deleteScan)
            return
        }
        val request = pending
        when {
            !success -> finishCancelledResult(request, pages)
            request == null || invalidated -> finishStaleResult(pages)
            else -> finishActiveResult(requireNotNull(request), pages, process)
        }
    }

    private fun finishCancelledResult(request: ReceiptScanRequest?, pages: List<T>) {
        pending = null
        pages.forEach(deleteScan)
        if (request != null && !invalidated) request.resolve(null)
        removeListenerAfterInvalidation()
    }

    private fun finishStaleResult(pages: List<T>) {
        pages.forEach(deleteScan)
        removeListenerAfterInvalidation()
    }

    private fun finishActiveResult(
        request: ReceiptScanRequest,
        pages: List<T>,
        process: (ReceiptScanRequest, T) -> Unit,
    ) {
        val uri = pages.firstOrNull()
        pages.drop(1).forEach(deleteScan)
        if (uri == null) {
            failOcr(request)
            return
        }
        ocrRequest = request
        ocrUri = uri
        runCatching { process(request, uri) }
            .onFailure { failImmediately(request, uri) }
    }

    @Synchronized
    fun completeOcr(request: ReceiptScanRequest, text: String) {
        if (pending !== request) return
        pending = null
        request.resolve(text)
    }

    @Synchronized
    fun failOcr(request: ReceiptScanRequest) {
        if (pending !== request) return
        pending = null
        request.reject("scan_failed", "Could not read the receipt.")
    }

    @Synchronized
    fun failImmediately(request: ReceiptScanRequest, uri: T?) {
        uri?.let(deleteScan)
        clearOcr(request)
        failOcr(request)
    }

    @Synchronized
    fun finishOcr(request: ReceiptScanRequest) {
        if (ocrRequest !== request) return
        val uri = ocrUri
        ocrRequest = null
        ocrUri = null
        uri?.let(deleteScan)
    }

    @Synchronized
    fun handleStartSuccess(request: ReceiptScanRequest, launch: () -> Unit) {
        if (invalidated || pending !== request) {
            scannerPending = false
            removeListenerAfterInvalidation()
            return
        }
        try { launch() } catch (_: Exception) { handleStartFailure(request) }
    }

    @Synchronized
    fun handleStartFailure(request: ReceiptScanRequest) {
        scannerPending = false
        if (pending === request) {
            pending = null
            request.reject("unavailable", "Receipt scanner is unavailable.")
        }
        removeListenerAfterInvalidation()
    }

    @Synchronized
    fun invalidate() {
        invalidated = true
        val request = pending
        pending = null
        request?.reject("interrupted", "Receipt scan interrupted.")
        if (!scannerPending) removeListenerAfterInvalidation()
    }

    private fun clearOcr(request: ReceiptScanRequest) {
        if (ocrRequest === request) {
            ocrRequest = null
            ocrUri = null
        }
    }

    private fun removeListenerAfterInvalidation() {
        if (invalidated && listenerRegistered) {
            listenerRegistered = false
            removeListener()
        }
    }
}
