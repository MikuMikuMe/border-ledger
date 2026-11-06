package com.lofuyu.borderledger.wealth

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class WealthCsvPayloadTest {
    @Test
    fun fullSizeEscapedCsvSurvivesPreviewAndRemapCommands() {
        // Build escaped input directly instead of formatting millions of control bytes.
        val encodedCsv = "\\u0001".repeat(2 * 1024 * 1024)
        for (remap in listOf(false, true)) {
            val mapping = if (remap) ",\"mapping\":{\"date\":\"Trade date\"}" else ""
            WealthWriteCommand("preview-boundary", "csv-preview", "{\"csv\":\"$encodedCsv\"$mapping}")
        }
    }
    @Test
    fun ordinaryWritesKeepTheirSmallerPayloadLimit() {
        val payload = JSONObject().put("note", "x".repeat(256 * 1024)).toString()
        assertThrows(IllegalArgumentException::class.java) {
            WealthWriteCommand("ordinary-boundary", "event", payload)
        }
    }

    @Test
    fun csvPreviewStillRejectsUnboundedPayloads() {
        val payload = JSONObject().put("csv", "x".repeat(13 * 1024 * 1024)).toString()
        assertThrows(IllegalArgumentException::class.java) {
            WealthWriteCommand("preview-too-large", "csv-preview", payload)
        }
    }
}
