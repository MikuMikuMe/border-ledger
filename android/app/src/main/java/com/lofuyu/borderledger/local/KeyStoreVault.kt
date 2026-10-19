package com.lofuyu.borderledger.local

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec


interface KeyStoreVault {
    fun encrypt(alias: String, plaintext: ByteArray, associatedData: ByteArray): ByteArray
    fun decrypt(alias: String, envelope: ByteArray, associatedData: ByteArray): ByteArray
}

/** Android Keystore-backed AES-GCM. A failed decrypt is a hard storage error. */
class AndroidKeyStoreVault(
    private val providerName: String = ANDROID_KEYSTORE,
    private val random: SecureRandom = SecureRandom(),
) : KeyStoreVault {
    override fun encrypt(alias: String, plaintext: ByteArray, associatedData: ByteArray): ByteArray {
        val key = keyFor(alias)
        return try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            // Android Keystore requires provider-generated IVs for its default
            // randomized-encryption policy. Keep that policy and the v1 envelope.
            cipher.init(Cipher.ENCRYPT_MODE, key, random)
            val iv = cipher.iv
            if (iv.size != GCM_IV_BYTES) throw SecureStorageException("Encrypted storage IV is not supported.")
            cipher.updateAAD(associatedData)
            val ciphertext = cipher.doFinal(plaintext)
            ByteArrayOutputStream().use { bytes ->
                DataOutputStream(bytes).use { output ->
                    output.writeByte(ENVELOPE_VERSION)
                    output.writeByte(iv.size)
                    output.write(iv)
                    output.writeInt(ciphertext.size)
                    output.write(ciphertext)
                }
                bytes.toByteArray()
            }
        } catch (error: Exception) {
            throw SecureStorageException("Encrypted storage could not be written.", error)
        }
    }

    override fun decrypt(alias: String, envelope: ByteArray, associatedData: ByteArray): ByteArray {
        return try {
            val input = DataInputStream(ByteArrayInputStream(envelope))
            val version = input.readUnsignedByte()
            val ivSize = input.readUnsignedByte()
            if (version != ENVELOPE_VERSION || ivSize != GCM_IV_BYTES) throw SecureStorageException("Encrypted storage format is not supported.")
            val iv = ByteArray(ivSize).also(input::readFully)
            val ciphertextSize = input.readInt()
            if (ciphertextSize <= 0 || ciphertextSize > MAX_ENVELOPE_BYTES) throw SecureStorageException("Encrypted storage payload is not valid.")
            val ciphertext = ByteArray(ciphertextSize).also(input::readFully)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, keyFor(alias), GCMParameterSpec(GCM_TAG_BITS, iv))
            cipher.updateAAD(associatedData)
            cipher.doFinal(ciphertext)
        } catch (error: SecureStorageException) {
            throw error
        } catch (error: Exception) {
            throw SecureStorageException("Encrypted storage could not be opened.", error)
        }
    }

    private fun keyFor(alias: String): SecretKey {
        if (!SAFE_ALIAS.matches(alias)) throw SecureStorageException("Encrypted storage key name is not valid.")
        return try {
            val keyStore = KeyStore.getInstance(providerName).apply { load(null) }
            val existing = keyStore.getEntry(alias, null) as? KeyStore.SecretKeyEntry
            if (existing != null) return existing.secretKey
            val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, providerName)
            generator.init(
                KeyGenParameterSpec.Builder(
                    alias,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setUserAuthenticationRequired(false)
                    .build(),
            )
            generator.generateKey()
        } catch (error: SecureStorageException) {
            throw error
        } catch (error: Exception) {
            throw SecureStorageException("Keystore key material is unavailable.", error)
        }
    }

    private companion object {
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val GCM_IV_BYTES = 12
        const val GCM_TAG_BITS = 128
        const val ENVELOPE_VERSION = 1
        const val MAX_ENVELOPE_BYTES = 16 * 1024 * 1024
        // Existing RN journal aliases are 17 + 16 + 64 characters. Do not rename
        // those persisted keys or broaden the accepted alphabet to fit them.
        val SAFE_ALIAS = Regex("[A-Za-z0-9._-]{1,97}")
    }
}
