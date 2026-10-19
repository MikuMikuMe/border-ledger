package com.lofuyu.borderledger.react

import com.lofuyu.borderledger.core.SecureRecordPort
import org.json.JSONObject
import java.security.MessageDigest

/**
 * Holds a short-lived Plaid public token only in the encrypted native record
 * store so an interrupted exchange can be replayed with the same backend key.
 * The token is never included in a bridge payload or operation journal.
 */
internal class PendingPlaidResultStore(private val records: SecureRecordPort) {
    suspend fun save(owner: String, operationId: String, publicToken: String) {
        require(owner.isNotBlank())
        require(operationId.matches(Regex("[A-Za-z0-9_-]{8,96}")))
        require(publicToken.isNotBlank() && publicToken.length <= MAX_TOKEN_LENGTH)
        val existing = read(owner, operationId)
        require(existing == null || existing == publicToken) { "A Plaid operation cannot change its provider result." }
        val value = JSONObject()
            .put("version", VERSION)
            .put("owner", owner)
            .put("operationId", operationId)
            .put("publicToken", publicToken)
        records.write(key(owner, operationId), value.toString().encodeToByteArray())
    }

    suspend fun read(owner: String, operationId: String): String? = records.read(key(owner, operationId))
        ?.let { JSONObject(it.decodeToString()) }
        ?.takeIf { it.getInt("version") == VERSION && it.getString("owner") == owner && it.getString("operationId") == operationId }
        ?.getString("publicToken")
        ?.takeIf { it.isNotBlank() }

    suspend fun clear(owner: String, operationId: String) {
        if (read(owner, operationId) != null) records.delete(key(owner, operationId))
    }

    private fun key(owner: String, operationId: String): String = "$PREFIX${digest("$owner\u0000$operationId")}"

    private fun digest(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.encodeToByteArray())
        .joinToString("") { "%02x".format(it) }

    private companion object {
        const val VERSION = 1
        const val MAX_TOKEN_LENGTH = 4096
        const val PREFIX = "rn_plaid_result_v1_"
    }
}
