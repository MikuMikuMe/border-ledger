package com.lofuyu.borderledger.accounts

import com.lofuyu.borderledger.auth.SessionBinding
import com.lofuyu.borderledger.core.SecureRecordPort
import java.net.URI
import java.time.Instant
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject

/** Result-only hints have no ability to exchange a sign-in code or authorize a user. */
class LunchFlowLinks(origin: String) {
    private val canonical=URI(origin)
    private fun endpoint(value: String, path: String): URI {
        val uri=URI(value)
        require(uri.scheme=="https" && uri.host==canonical.host && uri.port==canonical.port)
        require(uri.rawPath==path && uri.rawUserInfo==null && uri.rawFragment==null)
        return uri
    }
    fun callback(value: String) {
        val uri=endpoint(value,"/android/lunchflow/callback")
        require(uri.rawQuery in setOf("result=connected","result=failed"))
    }
    fun launch(value: String) {
        val uri=endpoint(value,"/api/lunchflow/oauth/launch")
        require(uri.rawQuery?.matches(Regex("ticket=[A-Za-z0-9_-]{20,256}"))==true)
    }
}

class LunchFlowHandoff(
    private val records: SecureRecordPort,
    private val binding: () -> SessionBinding?,
    private val status: suspend () -> LunchFlowConnection,
    private val begin: suspend () -> LunchFlowLaunch,
    private val open: (String) -> Unit,
    private val links: LunchFlowLinks,
    private val now: () -> Long = { Instant.now().epochSecond },
) {
    private val mutex=Mutex()
    suspend fun connection(): LunchFlowConnection {
        val owner=requireNotNull(binding())
        val value=status()
        check(binding()==owner && value.userId==owner.identity.userId && value.ledgerId==owner.identity.ledgerId)
        return value
    }
    suspend fun start()=mutex.withLock {
        val owner=requireNotNull(binding())
        val current=connection()
        check(current.configured && current.canReconnect && current.adapter=="platform")
        val launch=begin()
        check(binding()==owner)
        links.launch(launch.authorizationUrl)
        val observed=connection()
        check(observed.connectionId==launch.connectionId)
        val pending=JSONObject().put("epoch",owner.epoch).put("userId",owner.identity.userId).put("ledgerId",owner.identity.ledgerId)
            .put("connectionId",launch.connectionId).put("generation",observed.generation).put("expiresAt",now()+600)
        records.write(RECORD,pending.toString().encodeToByteArray())
        check(binding()==owner)
        try { open(launch.authorizationUrl) } catch(error: Exception) { records.delete(RECORD); throw error }
    }
    suspend fun cancel()=mutex.withLock { records.delete(RECORD) }
    suspend fun callback(value: String): LunchFlowConnection? = mutex.withLock {
        links.callback(value)
        val owner=binding() ?: return@withLock null
        val bytes=records.read(RECORD)
        if(bytes!=null){
            val pending=JSONObject(bytes.decodeToString())
            records.delete(RECORD) // Consume before network IO; replay is at most a status refresh.
            if(!matches(pending,owner))return@withLock null
            val current=connection()
            if(current.connectionId!=pending.getString("connectionId"))return@withLock null
            val previous=pending.getLong("generation")
            if(current.generation !in listOf(previous,previous+1))return@withLock null
            return@withLock current
        }
        connection() // Unsolicited hints never become a successful-authorization claim.
    }
    private fun matches(pending: JSONObject,owner: SessionBinding): Boolean =
        pending.getString("epoch")==owner.epoch && pending.getString("userId")==owner.identity.userId &&
        pending.getString("ledgerId")==owner.identity.ledgerId && pending.getLong("expiresAt")>=now()
    companion object { private const val RECORD="lunchflow_browser_pending_v1" }
}
