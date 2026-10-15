package com.lofuyu.borderledger.auth

import com.lofuyu.borderledger.api.RevocationGrantType
import com.lofuyu.borderledger.api.RevocationIntent
import com.lofuyu.borderledger.local.EncryptedRecordStore
import com.lofuyu.borderledger.local.LedgerRecord
import com.lofuyu.borderledger.local.RevocationQueue
import com.lofuyu.borderledger.local.SecureStorageException
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream

data class OwnerSessionRecord(
    val accessToken: String,
    val refreshToken: String,
    val expiresAt: String,
    val scopes: List<String>,
    val revision: Int,
    val revocationCapability: String,
    val deviceId: String?,
    val pendingDestination: String? = null,
)

data class PendingOwnerLogin(
    val requestId: String,
    val state: String,
    val verifier: String,
    val idempotencyKey: String,
    val deviceId: String?,
    val callbackUrl: String,
    val environment: String,
    val staySignedIn: Boolean,
    val expiresAt: String,
    val pendingDestination: String?,
)

data class PendingOwnerRotation(
    val idempotencyKey: String,
    val startedAt: String,
)

data class CompletedCallbackMarker(
    val stateDigest: String,
    val completedAt: String,
)

interface OwnerSessionStore : RevocationQueue {
    suspend fun readSession(): OwnerSessionRecord?
    suspend fun writeSession(value: OwnerSessionRecord)
    suspend fun clearSession()
    suspend fun readPendingLogin(): PendingOwnerLogin?
    suspend fun writePendingLogin(value: PendingOwnerLogin)
    suspend fun clearPendingLogin()
    suspend fun readPendingRotation(): PendingOwnerRotation?
    suspend fun writePendingRotation(value: PendingOwnerRotation)
    suspend fun clearPendingRotation()
    suspend fun readCompletedCallback(): CompletedCallbackMarker?
    suspend fun writeCompletedCallback(value: CompletedCallbackMarker)
}

/** Encrypted owner-only state; capture credentials use a different store/provider. */
class EncryptedOwnerSessionStore(private val records: EncryptedRecordStore) : OwnerSessionStore {
    override suspend fun readSession(): OwnerSessionRecord? = records.read(LedgerRecord.OWNER_SESSION)?.let(::decodeSession)

    override suspend fun writeSession(value: OwnerSessionRecord) {
        records.write(LedgerRecord.OWNER_SESSION, encodeSession(value))
    }

    override suspend fun clearSession() = records.delete(LedgerRecord.OWNER_SESSION)

    override suspend fun readPendingLogin(): PendingOwnerLogin? = records.read(LedgerRecord.OWNER_LOGIN_PENDING)?.let(::decodePendingLogin)

    override suspend fun writePendingLogin(value: PendingOwnerLogin) {
        records.write(LedgerRecord.OWNER_LOGIN_PENDING, encodePendingLogin(value))
    }

    override suspend fun clearPendingLogin() = records.delete(LedgerRecord.OWNER_LOGIN_PENDING)

    override suspend fun readPendingRotation(): PendingOwnerRotation? = records.read(LedgerRecord.OWNER_ROTATION_PENDING)?.let(::decodePendingRotation)

    override suspend fun writePendingRotation(value: PendingOwnerRotation) {
        records.write(LedgerRecord.OWNER_ROTATION_PENDING, encodePendingRotation(value))
    }

    override suspend fun clearPendingRotation() = records.delete(LedgerRecord.OWNER_ROTATION_PENDING)

    override suspend fun readCompletedCallback(): CompletedCallbackMarker? = records.read(LedgerRecord.OWNER_CALLBACK_MARKER)?.let(::decodeCompletedCallback)

    override suspend fun writeCompletedCallback(value: CompletedCallbackMarker) {
        records.write(LedgerRecord.OWNER_CALLBACK_MARKER, encodeCompletedCallback(value))
    }

    override suspend fun readPendingRevocations(): List<RevocationIntent> = records.read(LedgerRecord.OWNER_REVOCATIONS)?.let(::decodeRevocations) ?: emptyList()

    override suspend fun writePendingRevocations(values: List<RevocationIntent>) {
        if (values.isEmpty()) records.delete(LedgerRecord.OWNER_REVOCATIONS)
        else records.write(LedgerRecord.OWNER_REVOCATIONS, encodeRevocations(values))
    }

    private fun decodeSession(bytes: ByteArray): OwnerSessionRecord = guarded {
        DataInputStream(ByteArrayInputStream(bytes)).use { input ->
            checkVersion(input)
            val access = input.readUTF()
            val refresh = input.readUTF()
            val expiresAt = input.readUTF()
            val scopes = readStrings(input, MAX_SCOPES)
            val revision = input.readInt()
            val capability = input.readUTF()
            val deviceId = readNullable(input)
            val destination = readNullable(input)
            OwnerSessionRecord(access, refresh, expiresAt, scopes, revision, capability, deviceId, destination)
        }
    }

    private fun encodeSession(value: OwnerSessionRecord): ByteArray = ByteArrayOutputStream().use { bytes ->
        DataOutputStream(bytes).use { output ->
            output.writeInt(FORMAT_VERSION)
            output.writeUTF(value.accessToken)
            output.writeUTF(value.refreshToken)
            output.writeUTF(value.expiresAt)
            writeStrings(output, value.scopes)
            output.writeInt(value.revision)
            output.writeUTF(value.revocationCapability)
            writeNullable(output, value.deviceId)
            writeNullable(output, value.pendingDestination)
        }
        bytes.toByteArray()
    }

    private fun decodePendingLogin(bytes: ByteArray): PendingOwnerLogin = guarded {
        DataInputStream(ByteArrayInputStream(bytes)).use { input ->
            checkVersion(input)
            PendingOwnerLogin(
                requestId = input.readUTF(),
                state = input.readUTF(),
                verifier = input.readUTF(),
                idempotencyKey = input.readUTF(),
                deviceId = readNullable(input),
                callbackUrl = input.readUTF(),
                environment = input.readUTF(),
                staySignedIn = input.readBoolean(),
                expiresAt = input.readUTF(),
                pendingDestination = readNullable(input),
            )
        }
    }

    private fun encodePendingLogin(value: PendingOwnerLogin): ByteArray = ByteArrayOutputStream().use { bytes ->
        DataOutputStream(bytes).use { output ->
            output.writeInt(FORMAT_VERSION)
            output.writeUTF(value.requestId)
            output.writeUTF(value.state)
            output.writeUTF(value.verifier)
            output.writeUTF(value.idempotencyKey)
            writeNullable(output, value.deviceId)
            output.writeUTF(value.callbackUrl)
            output.writeUTF(value.environment)
            output.writeBoolean(value.staySignedIn)
            output.writeUTF(value.expiresAt)
            writeNullable(output, value.pendingDestination)
        }
        bytes.toByteArray()
    }

    private fun decodePendingRotation(bytes: ByteArray): PendingOwnerRotation = guarded {
        DataInputStream(ByteArrayInputStream(bytes)).use { input ->
            checkVersion(input)
            PendingOwnerRotation(input.readUTF(), input.readUTF())
        }
    }

    private fun encodePendingRotation(value: PendingOwnerRotation): ByteArray = ByteArrayOutputStream().use { bytes ->
        DataOutputStream(bytes).use { output ->
            output.writeInt(FORMAT_VERSION)
            output.writeUTF(value.idempotencyKey)
            output.writeUTF(value.startedAt)
        }
        bytes.toByteArray()
    }

    private fun decodeCompletedCallback(bytes: ByteArray): CompletedCallbackMarker = guarded {
        DataInputStream(ByteArrayInputStream(bytes)).use { input ->
            checkVersion(input)
            CompletedCallbackMarker(input.readUTF(), input.readUTF())
        }
    }

    private fun encodeCompletedCallback(value: CompletedCallbackMarker): ByteArray = ByteArrayOutputStream().use { bytes ->
        DataOutputStream(bytes).use { output ->
            output.writeInt(FORMAT_VERSION)
            output.writeUTF(value.stateDigest)
            output.writeUTF(value.completedAt)
        }
        bytes.toByteArray()
    }

    private fun decodeRevocations(bytes: ByteArray): List<RevocationIntent> = guarded {
        DataInputStream(ByteArrayInputStream(bytes)).use { input ->
            checkVersion(input)
            val count = input.readInt()
            require(count in 0..MAX_REVOCATIONS)
            List(count) {
                val grantType = when (input.readUTF()) {
                    "owner" -> RevocationGrantType.OwnerFamily
                    "capture" -> RevocationGrantType.CaptureCredential
                    else -> error("grant type")
                }
                RevocationIntent(grantType, input.readInt(), input.readUTF(), input.readUTF())
            }
        }
    }

    private fun encodeRevocations(values: List<RevocationIntent>): ByteArray = ByteArrayOutputStream().use { bytes ->
        DataOutputStream(bytes).use { output ->
            require(values.size <= MAX_REVOCATIONS)
            output.writeInt(FORMAT_VERSION)
            output.writeInt(values.size)
            values.forEach { value ->
                output.writeUTF(if (value.grantType == RevocationGrantType.OwnerFamily) "owner" else "capture")
                output.writeInt(value.generation)
                output.writeUTF(value.capability)
                output.writeUTF(value.createdAt)
            }
        }
        bytes.toByteArray()
    }

    private companion object {
        const val FORMAT_VERSION = 1
        const val MAX_SCOPES = 32
        const val MAX_REVOCATIONS = 32

        fun checkVersion(input: DataInputStream) {
            if (input.readInt() != FORMAT_VERSION) error("format")
        }

        fun readStrings(input: DataInputStream, max: Int): List<String> {
            val count = input.readInt()
            require(count in 0..max)
            return List(count) { input.readUTF() }
        }

        fun writeStrings(output: DataOutputStream, values: List<String>) {
            require(values.size <= MAX_SCOPES)
            output.writeInt(values.size)
            values.forEach(output::writeUTF)
        }

        fun writeNullable(output: DataOutputStream, value: String?) {
            output.writeBoolean(value != null)
            if (value != null) output.writeUTF(value)
        }

        fun readNullable(input: DataInputStream): String? = if (input.readBoolean()) input.readUTF() else null

        inline fun <T> guarded(block: () -> T): T = try {
            block()
        } catch (error: SecureStorageException) {
            throw error
        } catch (error: Exception) {
            throw SecureStorageException("Encrypted owner state is not valid.", error)
        }
    }
}
