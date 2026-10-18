package com.lofuyu.borderledger.auth

import com.lofuyu.borderledger.local.EncryptedRecordStore
import com.lofuyu.borderledger.local.LedgerRecord
import com.lofuyu.borderledger.local.SecureStorageException
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream


class EncryptedCaptureCredentialProvider(private val records: EncryptedRecordStore) : CaptureCredentialProvider {
    override suspend fun current(): CaptureCredentialRecord? = records.read(LedgerRecord.CAPTURE_CREDENTIAL)?.let(::decode)

    override suspend fun save(value: CaptureCredentialRecord) {
        records.write(LedgerRecord.CAPTURE_CREDENTIAL, encode(value))
    }

    override suspend fun clear() = records.delete(LedgerRecord.CAPTURE_CREDENTIAL)

    private fun decode(bytes: ByteArray): CaptureCredentialRecord = try {
        DataInputStream(ByteArrayInputStream(bytes)).use { input ->
            if (input.readInt() != FORMAT_VERSION) throw SecureStorageException("Encrypted capture state format is not supported.")
            CaptureCredentialRecord(input.readUTF(), input.readUTF(), input.readInt(), input.readUTF(), input.readUTF())
        }
    } catch (error: SecureStorageException) {
        throw error
    } catch (error: Exception) {
        throw SecureStorageException("Encrypted capture state is not valid.", error)
    }

    private fun encode(value: CaptureCredentialRecord): ByteArray = ByteArrayOutputStream().use { bytes ->
        DataOutputStream(bytes).use { output ->
            output.writeInt(FORMAT_VERSION)
            output.writeUTF(value.credential)
            output.writeUTF(value.deviceId)
            output.writeInt(value.generation)
            output.writeUTF(value.expiresAt)
            output.writeUTF(value.revocationCapability)
        }
        bytes.toByteArray()
    }

    private companion object {
        const val FORMAT_VERSION = 1
    }
}
