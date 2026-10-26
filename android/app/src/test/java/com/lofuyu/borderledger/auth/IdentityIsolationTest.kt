package com.lofuyu.borderledger.auth

import com.lofuyu.borderledger.IdentityFixture
import com.lofuyu.borderledger.local.EncryptedRecordStore
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

class IdentityIsolationTest {
    @Test
    fun credentialSwitchDuringAttachmentCannotSendOldEventWithNewToken() = runTest {
        val first = IdentityFixture()
        val second = IdentityFixture("b", "b-ledger", "b-session")
        val lookup = CompletableDeferred<CaptureCredentialRecord?>()
        val credentials = object : CaptureCredentialProvider {
            override suspend fun current() = lookup.await()
            override suspend fun save(value: CaptureCredentialRecord) = Unit
            override suspend fun clear() = Unit
        }
        val interceptor = CaptureAuthInterceptor(credentials, ApiEnvironment("https://pf.example.com", "sandbox"))
        val attached = async {
            withContext(CaptureWork(first.credential!!)) {
                runCatching { interceptor.intercept(MobileRequest("POST", "https://pf.example.com/api/mobile/v1/alerts")) }
            }
        }
        testScheduler.runCurrent()
        lookup.complete(second.credential)
        assertTrue(attached.await().exceptionOrNull() is CredentialBoundaryException)
    }

    @Test
    fun encryptedPartitionsRetainLegacyAndOtherAccountsWithoutRetagging() = runTest {
        val values = mutableMapOf("capture_intake" to byteArrayOf(7), "outbox_queue" to byteArrayOf(8))
        val records = object : EncryptedRecordStore {
            override suspend fun read(record: String) = values[record]?.copyOf()
            override suspend fun write(record: String, value: ByteArray) { values[record] = value.copyOf() }
            override suspend fun delete(record: String) { values.remove(record) }
        }
        val identity = IdentityFixture()
        val scoped = CaptureIdentityRecords(records, identity.boundary)
        identity.boundary.run(Unit) { scoped.write("capture_intake", byteArrayOf(1)) }
        val beforeSwitch = values.mapValues { it.value.toList() }
        val second = IdentityFixture("b", "b-ledger", "b-session")
        identity.binding = second.binding
        identity.credential = second.credential
        identity.boundary.run(Unit) { assertNull(scoped.read("capture_intake")) }
        assertEquals(beforeSwitch, values.mapValues { it.value.toList() })
        assertEquals(listOf<Byte>(7), values["capture_intake"]!!.toList())
    }
}
