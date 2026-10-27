package com.lofuyu.borderledger.local

import com.lofuyu.borderledger.api.RevocationGrantType
import com.lofuyu.borderledger.api.RevocationIntent
import com.lofuyu.borderledger.auth.*
import java.time.Instant
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

/** Literal v1 byte fixtures, independent of the current encoders. No real credentials or records. */
class LegacyCoreCodecCompatibilityTest {
    private val now = "2026-10-16T12:00:00Z"
    private val expiry = "2099-01-01T00:00:00Z"

    @Test fun ownerSessionModifiedUtfAndNullableFieldsRemainByteCompatible() = runTest {
        val records = FixtureRecords("owner_session", fixture("owner-session"))
        val store = EncryptedOwnerSessionStore(records)
        val expected = OwnerSessionRecord("a\u0000账", "r", expiry, listOf("ledger:read"), 3, "cap", "device", "/capture")
        assertEquals(expected, store.readSession())
        assertNull(store.readSession()?.identity)
        val bound = expected.copy(identity = LedgerIdentity("owner", "personal"), epoch = "new-login")
        store.writeSession(bound)
        assertEquals(bound, store.readSession())
    }

    @Test fun pendingLoginKeepsVerifierEnvironmentAndUncheckedStaySignedInBytes() = runTest {
        val records = FixtureRecords("owner_login_pending", fixture("owner-login"))
        val store = EncryptedOwnerSessionStore(records)
        val expected = PendingOwnerLogin("req", "state", "verifier", "key", "device", "https://pf.example.com/android/auth/callback", "sandbox", false, expiry, null)
        assertEquals(expected, store.readPendingLogin())
        store.writePendingLogin(expected)
        assertArrayEquals(fixture("owner-login"), records.bytes("owner_login_pending"))
    }

    @Test fun pendingRotationAndCompletedMarkerKeepLegacyNamesAndBytes() = runTest {
        val records = FixtureRecords("owner_rotation_pending", fixture("owner-rotation"))
        records.seed("owner_callback_marker", fixture("owner-marker"))
        val store = EncryptedOwnerSessionStore(records)
        assertEquals(PendingOwnerRotation("key", now), store.readPendingRotation())
        assertEquals(CompletedCallbackMarker("digest", now), store.readCompletedCallback())
        store.writePendingRotation(requireNotNull(store.readPendingRotation()))
        store.writeCompletedCallback(requireNotNull(store.readCompletedCallback()))
        assertArrayEquals(fixture("owner-rotation"), records.bytes("owner_rotation_pending"))
        assertArrayEquals(fixture("owner-marker"), records.bytes("owner_callback_marker"))
    }

    @Test fun ownerAndCaptureRevocationsRetainWireTagsAndGeneration() = runTest {
        val records = FixtureRecords("owner_revocations", fixture("owner-revocations"))
        val store = EncryptedOwnerSessionStore(records)
        val expected = listOf(RevocationIntent(RevocationGrantType.OwnerFamily, 3, "owner-cap", now),
            RevocationIntent(RevocationGrantType.CaptureCredential, 4, "capture-cap", now))
        assertEquals(expected, store.readPendingRevocations())
        store.writePendingRevocations(expected)
        assertArrayEquals(fixture("owner-revocations"), records.bytes("owner_revocations"))
    }

    @Test fun captureCredentialDoesNotChangeDeviceIdentityOrBinaryEncoding() = runTest {
        val records = FixtureRecords("capture_credential", fixture("capture-credential"))
        val store = EncryptedCaptureCredentialProvider(records)
        val expected = CaptureCredentialRecord("capture", "device", 4, expiry, "capture-cap")
        assertEquals(expected, store.current())
        assertNull(store.current()?.identity)
        val bound = expected.copy(identity = LedgerIdentity("owner", "personal"), sessionEpoch = "new-login")
        store.save(bound)
        assertEquals(bound, store.current())
    }

    @Test fun legacyQueuedEventsAndReadCacheAreNotAdoptedByANewSession() = runTest {
        val records = FixtureRecords("outbox_queue", fixture("outbox"))
        records.seed("financial_read_cache", fixture("read-cache"))
        val binding = SessionBinding(LedgerIdentity("second", "second-ledger"), "new-login")
        assertTrue(EncryptedOutboxDao(records, binding).nextBatch(1).isEmpty())
        assertNull(EncryptedOwnerReadCache(records).readIfUsable(Instant.parse(now), binding))
        assertArrayEquals(fixture("outbox"), records.bytes("outbox_queue"))
        assertArrayEquals(fixture("read-cache"), records.bytes("financial_read_cache"))
    }

    @Test fun unknownSessionVersionFailsClosedAndPreservesOriginalBytes() = runTest {
        val legacy = fixture("owner-session").also { it[3] = 99 }
        val records = FixtureRecords("owner_session", legacy)
        try {
            EncryptedOwnerSessionStore(records).readSession()
            fail("Unknown disk versions must not be accepted")
        } catch (_: SecureStorageException) {
            assertArrayEquals(legacy, records.bytes("owner_session"))
        }
    }

    private fun fixture(name: String): ByteArray {
        val hex = requireNotNull(javaClass.getResourceAsStream("/legacy-v1/$name.hex")).bufferedReader().use { it.readText().trim() }
        return hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    }
}

private class FixtureRecords(name: String? = null, value: ByteArray? = null) : EncryptedRecordStore {
    private val values = mutableMapOf<String, ByteArray>()
    init { if (name != null && value != null) seed(name, value) }
    fun seed(name: String, value: ByteArray) { values[name] = value.copyOf() }
    fun bytes(name: String) = values[name]?.copyOf()
    override suspend fun read(record: String) = bytes(record)
    override suspend fun write(record: String, value: ByteArray) { seed(record, value) }
    override suspend fun delete(record: String) { values.remove(record) }
}
