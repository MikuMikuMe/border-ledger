package com.lofuyu.borderledger.wealth

import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.UUID

class WealthIdentifierTest {
    @Test
    fun createsDistinctCanonicalUuidValues() {
        val first = WealthIdentifier.create()
        val second = WealthIdentifier.create()

        assertTrue(runCatching { UUID.fromString(first) }.isSuccess)
        assertTrue(runCatching { UUID.fromString(second) }.isSuccess)
        assertNotEquals(first, second)
    }
}
