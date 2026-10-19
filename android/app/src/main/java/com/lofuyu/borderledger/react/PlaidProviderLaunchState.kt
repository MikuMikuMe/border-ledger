package com.lofuyu.borderledger.react

import com.lofuyu.borderledger.core.SecureRecordPort
import java.security.MessageDigest

/** Durable marker used to avoid canceling a Plaid authorization that may still be visible externally. */
internal class PlaidProviderLaunchState(private val records: SecureRecordPort) {
    suspend fun markStarted(owner: String, operationId: String) {
        records.write(key(owner, operationId), byteArrayOf(1))
    }

    suspend fun wasStarted(owner: String, operationId: String): Boolean =
        records.read(key(owner, operationId))?.contentEquals(byteArrayOf(1)) == true

    suspend fun clear(owner: String, operationId: String) {
        records.delete(key(owner, operationId))
    }

    private fun key(owner: String, operationId: String): String =
        "rn_plaid_launch_v1_${digest(owner)}_${digest(operationId)}"

    private fun digest(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.encodeToByteArray())
        .joinToString("") { "%02x".format(it) }
}
