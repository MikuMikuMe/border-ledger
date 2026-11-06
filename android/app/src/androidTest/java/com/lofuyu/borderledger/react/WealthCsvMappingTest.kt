package com.lofuyu.borderledger.react

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.lofuyu.borderledger.wealth.WealthWriteCommand
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class WealthCsvMappingTest {
    @Test
    fun supportedSourceHeadersSurviveNativeRemapping() {
        val mapping = JSONObject().put("amount_minor", "amount (cad)").put("quantity", "quantité")
            .put("memo", "备注 / note").put("date", "trade,date").put("account_id", "quote\"header")
            .put("source_id", "x".repeat(129))
        val parsed = parseWealthCsvMapping(mapping.toString())
        assertEquals(mapping.toString(), parsed.toString())
        WealthWriteCommand("custom-mapping", "csv-preview", JSONObject().put("csv", "synthetic").put("mapping", parsed).toString())
    }

    @Test
    fun nullMappingsRemainSupported() {
        assertEquals(JSONObject.NULL, parseWealthCsvMapping("{\"quantity\":null}").get("quantity"))
    }

    @Test
    fun invalidMappingValuesAndCanonicalKeysRemainRejected() {
        for (value in listOf("", " \t\n", 123, true, JSONObject(), JSONArray())) {
            assertThrows(IllegalArgumentException::class.java) {
                parseWealthCsvMapping(JSONObject().put("quantity", value).toString())
            }
        }
        assertThrows(IllegalArgumentException::class.java) {
            parseWealthCsvMapping("{\"amount (cad)\":\"amount\"}")
        }
    }

    @Test
    fun mappingLimitCountsUtf8BytesAndRejectsOversizedObjects() {
        assertThrows(IllegalArgumentException::class.java) {
            parseWealthCsvMapping(JSONObject().put("memo", "备".repeat(22000)).toString())
        }
    }
}
