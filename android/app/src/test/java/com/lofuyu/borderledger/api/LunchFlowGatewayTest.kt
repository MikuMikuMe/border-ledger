package com.lofuyu.borderledger.api

import com.lofuyu.borderledger.accounts.AccountHttpTransport
import com.lofuyu.borderledger.accounts.HttpWorkerAccountConnectionGateway
import com.lofuyu.borderledger.accounts.IdempotencyKey
import com.lofuyu.borderledger.accounts.LunchFlowSelection
import com.lofuyu.borderledger.accounts.LunchFlowSelectionRequest
import com.lofuyu.borderledger.accounts.LunchFlowSyncRequest
import com.lofuyu.borderledger.auth.MobileRequest
import com.lofuyu.borderledger.auth.OwnerCredentialProvider
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.json.JSONObject

class LunchFlowGatewayTest {
    @Test
    fun discoveryDecodesNullableProviderCurrencyAndLastError() = runTest {
        val gateway = gateway(
            """
            {"configured":true,"accounts":[{"providerAccountId":"provider-1","name":"Everyday chequing","institution":"RBC","currencies":["CAD"],"selected":false,"accountId":null,"kind":null,"currency":null,"lastSyncedAt":null,"lastError":"provider_unavailable"}]}
            """.trimIndent(),
        )

        val account = gateway.readLunchFlowAccounts().accounts.single()

        assertEquals("provider-1", account.providerAccountId)
        assertNull(account.accountId)
        assertNull(account.kind)
        assertNull(account.currency)
        assertEquals("provider_unavailable", account.lastError)
    }

    @Test
    fun localStatusUsesTheOwnerBearerAndAvoidsProviderDiscovery() = runTest {
        var request: MobileRequest? = null
        val gateway = HttpWorkerAccountConnectionGateway(
            origin = "https://pf.example",
            environment = "sandbox",
            ownerCredentials = OwnerCredentialProvider { "owner-token" },
            transport = object : AccountHttpTransport {
                override suspend fun execute(value: MobileRequest): ByteArray {
                    request = value
                    return """{"configured":true,"accounts":[]}""".encodeToByteArray()
                }
            },
        )

        gateway.readLunchFlowStatus()

        assertEquals("GET", request?.method)
        assertEquals("https://pf.example/api/mobile/v1/lunchflow/accounts?status=local", request?.url)
        assertEquals("Bearer owner-token", request?.headers?.get("Authorization"))
    }

    @Test
    fun selectionUsesOwnerBearerAndIdempotencyKeyWithExactPayload() = runTest {
        var request: MobileRequest? = null
        val gateway = HttpWorkerAccountConnectionGateway(
            origin = "https://pf.example",
            environment = "sandbox",
            ownerCredentials = OwnerCredentialProvider { "owner-token" },
            transport = object : AccountHttpTransport {
                override suspend fun execute(value: MobileRequest): ByteArray {
                    request = value
                    return """{"selected":1,"queued":true}""".encodeToByteArray()
                }
            },
        )

        val receipt = gateway.selectLunchFlowAccounts(
            LunchFlowSelectionRequest(
                accounts = listOf(LunchFlowSelection("provider-1", "CAD", "credit")),
                idempotencyKey = IdempotencyKey("request-1"),
            ),
        )

        assertEquals("POST", request?.method)
        assertEquals("https://pf.example/api/mobile/v1/lunchflow/account-selection", request?.url)
        assertEquals("Bearer owner-token", request?.headers?.get("Authorization"))
        assertEquals("request-1", request?.headers?.get("Idempotency-Key"))
        assertEquals("application/json; charset=utf-8", request?.headers?.get("Content-Type"))
        val account = JSONObject(request?.body?.toString(Charsets.UTF_8)).getJSONArray("accounts").getJSONObject(0)
        assertEquals(setOf("providerAccountId", "currency", "kind"), account.keys().asSequence().toSet())
        assertEquals("provider-1", account.getString("providerAccountId"))
        assertEquals("CAD", account.getString("currency"))
        assertEquals("credit", account.getString("kind"))
        assertEquals(1, receipt.selected)
        assertTrue(receipt.queued)
    }

    @Test
    fun syncUsesTheDedicatedRouteAndIdempotencyKey() = runTest {
        var request: MobileRequest? = null
        val gateway = HttpWorkerAccountConnectionGateway(
            origin = "https://pf.example",
            environment = "sandbox",
            ownerCredentials = OwnerCredentialProvider { "owner-token" },
            transport = object : AccountHttpTransport {
                override suspend fun execute(value: MobileRequest): ByteArray {
                    request = value
                    return """{"queued":true,"accounts":2}""".encodeToByteArray()
                }
            },
        )

        val receipt = gateway.syncLunchFlow(LunchFlowSyncRequest(IdempotencyKey("sync-1")))

        assertEquals("POST", request?.method)
        assertEquals("https://pf.example/api/mobile/v1/lunchflow/sync", request?.url)
        assertEquals("sync-1", request?.headers?.get("Idempotency-Key"))
        assertEquals(2, receipt.accounts)
    }
}

private fun gateway(body: String): HttpWorkerAccountConnectionGateway = HttpWorkerAccountConnectionGateway(
    origin = "https://pf.example",
    environment = "sandbox",
    ownerCredentials = OwnerCredentialProvider { "owner-token" },
    transport = object : AccountHttpTransport {
        override suspend fun execute(value: MobileRequest): ByteArray = body.encodeToByteArray()
    },
)
