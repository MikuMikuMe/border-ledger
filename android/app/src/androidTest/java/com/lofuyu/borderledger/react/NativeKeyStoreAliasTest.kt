package com.lofuyu.borderledger.react

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.lofuyu.borderledger.local.AndroidKeyStoreVault
import com.lofuyu.borderledger.local.SecureStorageException
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.security.MessageDigest
import java.nio.ByteBuffer

@RunWith(AndroidJUnit4::class)
class NativeKeyStoreAliasTest {
    private val vault = AndroidKeyStoreVault()
    private val aad = "task8_synthetic_record".encodeToByteArray()
    private val value = "task8 synthetic payload".encodeToByteArray()

    @Test fun exactNativeJournalAliasRoundTripsWithoutRenamingTheKey() {
        val digest = MessageDigest.getInstance("SHA-256").digest("task8_synthetic_alias".encodeToByteArray())
            .joinToString("") { "%02x".format(it) }
        val alias = "border_ledger_v1_rn_operation_v1_$digest"
        assertEquals(97, alias.length)
        val encrypted = vault.encrypt(alias, value, aad)
        assertArrayEquals(value, vault.decrypt(alias, encrypted, aad))
        assertFalse(encrypted.contentEquals(vault.encrypt(alias, value, aad)))
        assertEquals(1, encrypted[0].toInt())
        assertEquals(12, encrypted[1].toInt())
        val ciphertextSize = ByteBuffer.wrap(encrypted, 14, 4).int
        assertEquals(value.size + 16, ciphertextSize)
        assertEquals(18 + ciphertextSize, encrypted.size)
        try { vault.decrypt(alias, encrypted, "wrong task8 AAD".encodeToByteArray()); fail("Wrong AAD accepted") }
        catch (_: SecureStorageException) { /* Authentication remains mandatory. */ }
    }

    @Test fun existingShortAliasAndEnvelopeStillRoundTrip() {
        val alias = "border_ledger_v1_task8_synthetic_legacy"
        val encrypted = vault.encrypt(alias, value, aad)
        assertArrayEquals(value, AndroidKeyStoreVault().decrypt(alias, encrypted, aad))
        assertEquals(1, encrypted[0].toInt())
        assertEquals(12, encrypted[1].toInt())
    }

    @Test fun unrelatedInvalidAliasNamesRemainRejected() {
        for (alias in listOf("", "x".repeat(98), "task8/invalid", "task8 invalid")) {
            try { vault.encrypt(alias, value, aad); fail("Invalid alias accepted") }
            catch (_: SecureStorageException) { /* No invalid alias reaches the Keystore. */ }
        }
    }
}
