package com.lofuyu.borderledger.recurring

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RecurringRepositoryTest {
    @Test
    fun decodesInitialCurrenciesAndPreservesSourceValues() {
        val page = RecurringJson.decodePage(
            """
            {
              "items":[
                {"id":"cad-1","accountId":"cad-account","currency":"CAD","merchantName":"Transit","frequency":"MONTHLY","classification":"subscription","sourceStatus":"MATURE","averageAmountMinor":-1234,"predictedNextDate":"2026-10-20","revision":2},
                {"id":"cny-1","accountId":"cny-account","currency":"CNY","merchantName":"Rent","frequency":"MONTHLY","classification":"bill","sourceStatus":"MATURE","averageAmountMinor":-260000,"predictedNextDate":null,"revision":1},
                {"id":"usd-1","accountId":"usd-account","currency":"USD","merchantName":"Cloud","frequency":"MONTHLY","classification":"other","sourceStatus":"MATURE","averageAmountMinor":-999,"predictedNextDate":null,"revision":3},
                {"id":"hkd-1","accountId":"hkd-account","currency":"HKD","merchantName":"Transit","frequency":"MONTHLY","classification":"subscription","sourceStatus":"MATURE","averageAmountMinor":-4500,"predictedNextDate":null,"revision":4}
              ],
              "page":{"nextCursor":"next","limit":4},"state":"ready","checkedAt":"2026-10-13T15:00:00Z","sourceUpdatedAt":"2026-10-13T14:00:00Z","lastError":null,"coverageWarnings":[]
            }
            """.trimIndent().encodeToByteArray(),
        )

        assertEquals(listOf("CAD", "CNY", "USD", "HKD"), page.items.map { it.currency })
        assertEquals(-1234L, page.items[0].averageAmountMinor)
        assertEquals(-260000L, page.items[1].averageAmountMinor)
        assertEquals(-999L, page.items[2].averageAmountMinor)
        assertEquals(-4500L, page.items[3].averageAmountMinor)
        assertEquals(2, page.items[0].revision)
        assertEquals("ready", page.state)
    }

    @Test
    fun acceptsRegisteredNonInitialCurrency() {
        val page = RecurringJson.decodePage(
            """{"items":[{"id":"x","accountId":"a","currency":"JPY","merchantName":null,"frequency":"UNKNOWN","classification":"unclassified","sourceStatus":"MATURE","averageAmountMinor":null,"predictedNextDate":null,"revision":0}],"page":{"nextCursor":null,"limit":50},"state":"ready","checkedAt":null,"sourceUpdatedAt":null,"lastError":null,"coverageWarnings":[]}""".encodeToByteArray(),
        )

        assertEquals("JPY", page.items.single().currency)
    }

    @Test
    fun rejectsUnknownCurrency() {
        val result = runCatching {
            RecurringJson.decodePage(
                """{"items":[{"id":"x","accountId":"a","currency":"ZZZ","merchantName":null,"frequency":"UNKNOWN","classification":"unclassified","sourceStatus":"MATURE","averageAmountMinor":null,"predictedNextDate":null,"revision":0}],"page":{"nextCursor":null,"limit":50},"state":"ready","checkedAt":null,"sourceUpdatedAt":null,"lastError":null,"coverageWarnings":[]}""".encodeToByteArray(),
            )
        }

        assertTrue(result.isFailure)
    }

    @Test
    fun exposesValidatedInitialCurrencyOrderForNativeFilters() {
        assertEquals(listOf("CAD", "CNY", "USD", "HKD"), RecurringCurrencyPolicy.initialCodes)
    }

    @Test
    fun classificationBodyCarriesExpectedRevision() {
        assertEquals(
            "{\"expectedRevision\":3,\"classification\":\"bill\"}",
            RecurringJson.classificationBody(3, "bill"),
        )
    }
}
