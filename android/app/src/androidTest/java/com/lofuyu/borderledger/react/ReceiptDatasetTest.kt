package com.lofuyu.borderledger.react

import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.io.File
import java.util.concurrent.TimeUnit
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Opt-in offline benchmark; test data and OCR results remain in app-specific storage. */
@RunWith(AndroidJUnit4::class)
class ReceiptDatasetTest {
    @Test
    fun recognizeDatasetImages() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val dataset = InstrumentationRegistry.getArguments().getString("receiptDataset")
        assumeTrue("No receipt dataset requested", dataset != null)
        require(dataset!!.matches(Regex("[a-zA-Z0-9_-]+")))
        val folder = File(instrumentation.targetContext.filesDir, dataset)
        val images = folder.listFiles { file -> file.name.matches(Regex("[0-9]{3}\\.jpg")) }?.sortedBy { it.name }.orEmpty()
        assertTrue("Receipt dataset contains no images", images.isNotEmpty())
        val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        var recognized = 0
        try {
            File(folder, "ocr.jsonl").bufferedWriter().use { output ->
                for (file in images) {
                    val row = JSONObject().put("id", file.nameWithoutExtension.toInt())
                    try {
                        val image = InputImage.fromFilePath(instrumentation.targetContext, Uri.fromFile(file))
                        val result = Tasks.await(recognizer.process(image), 60, TimeUnit.SECONDS)
                        val lines = result.textBlocks.flatMap { it.lines }.map { line ->
                            val box = line.boundingBox
                            ReceiptTextLine(line.text, box?.left ?: 0, box?.top ?: 0, box?.right ?: 0, box?.bottom ?: 0)
                        }
                        row.put("text", receiptTextInReadingOrder(lines, result.text))
                        recognized++
                    } catch (_: Exception) {
                        row.put("error", "recognition failed")
                    }
                    output.appendLine(row.toString())
                }
            }
            assertTrue("All receipt recognition attempts failed", recognized > 0)
        } finally {
            recognizer.close()
        }
    }
}
