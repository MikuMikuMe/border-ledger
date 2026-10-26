package com.lofuyu.borderledger.accounts

import org.json.JSONObject

data class LunchFlowBinding(val connectionId: String, val expectedGeneration: Long) {
    init { require(connectionId.isNotBlank() && expectedGeneration in 1..9007199254740991L) }
    fun encodedId(): String = java.net.URLEncoder.encode(connectionId, "UTF-8")
    fun json(): JSONObject = JSONObject().put("connectionId", connectionId).put("expectedGeneration", expectedGeneration)
    fun verify(value: LunchFlowAccounts) { if(value.connectionId != connectionId || value.generation != expectedGeneration) throw LunchFlowRequestFailure("connection_generation_conflict", false) }
}
// This native-only value is never projected to the JavaScript bridge or logs.
class LunchFlowLaunch(val authorizationUrl: String, val connectionId: String)
data class LunchFlowConnection(
    val userId: String, val ledgerId: String, val connectionId: String?, val generation: Long?,
    val adapter: String, val configured: Boolean, val connected: Boolean, val reconnectRequired: Boolean,
    val canReconnect: Boolean, val remoteRevocation: String, val reason: String, val retryable: Boolean,
) {
    init { require(userId.isNotBlank() && ledgerId.isNotBlank()); require(adapter in listOf("personal", "platform")) }
    companion object {
        fun decode(v: JSONObject) = LunchFlowConnection(
            v.getString("userId"), v.getString("ledgerId"), if(v.isNull("connectionId")) null else v.getString("connectionId"),
            if(v.isNull("generation")) null else v.getLong("generation"), v.getString("adapter"), v.getBoolean("configured"),
            v.getBoolean("connected"), v.getBoolean("reconnectRequired"), v.getBoolean("canReconnect"),
            v.getString("remoteRevocation"), v.getString("reason"), v.getBoolean("retryable"),
        )
    }
}
internal val LUNCH_FLOW_ERROR_CODES = setOf("connection_generation_conflict", "connection_required", "connection_not_found", "reconnect_required", "operation_in_progress", "operation_uncertain", "configuration_required", "application_configuration_changed", "bank_connection_changed", "provider_identity_conflict")
class LunchFlowRequestFailure(val code: String, val retryable: Boolean) : Exception()
