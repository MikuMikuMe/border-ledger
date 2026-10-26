package com.lofuyu.borderledger.ui.accounts.devices

import com.lofuyu.borderledger.auth.MobileRequest
import com.lofuyu.borderledger.auth.OwnerCredentialProvider
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceManagementRepositoryTest {
    @Test
    fun readDevicesUsesOwnerBearerAndPreservesSourceScopeRevision() = runTest {
        var request: MobileRequest? = null
        val repository = HttpWorkerDeviceManagementRepository(
            origin = "https://pf.example",
            environment = "sandbox",
            ownerCredentials = com.lofuyu.borderledger.ownerCredentials("owner-token"),
            transport = DeviceHttpTransport { captured ->
                request = captured
                DeviceHttpResponse(200, """
                    {"devices":[{"id":"device-1","name":"Pixel","platform":"android","status":"paired","credentialExpiresAt":"2027-01-01T00:00:00Z","revokedAt":null,"sourceConfig":{"expectedRevision":3,"mappings":[{"sourceProfileId":"boc","accountId":"account-1","allowedCurrencies":["CNY"],"instrumentHint":{"kind":"card_suffix","value":"1234"}}]},"revision":3}]}
                """.trimIndent())
            },
        )

        val device = repository.readDevices().single()

        assertEquals("GET", request?.method)
        assertEquals("https://pf.example/api/mobile/v1/devices", request?.url)
        assertEquals("Bearer owner-token", request?.headers?.get("Authorization"))
        assertEquals(3, device.revision)
        assertEquals("boc", device.sourceMappings.single().sourceProfileId)
        assertEquals("account-1", device.sourceMappings.single().accountId)
        assertEquals(listOf("CNY"), device.sourceMappings.single().allowedCurrencies)
        assertEquals(InstrumentHint("card_suffix", "1234"), device.sourceMappings.single().instrumentHint)
        assertEquals(null, device.revokedAt)
    }

    @Test
    fun replaceSourceConfigSendsOnlyTheOwnerScopedConfig() = runTest {
        var request: MobileRequest? = null
        val repository = HttpWorkerDeviceManagementRepository(
            origin = "https://pf.example",
            environment = "sandbox",
            ownerCredentials = com.lofuyu.borderledger.ownerCredentials("owner-token"),
            transport = DeviceHttpTransport { captured ->
                request = captured
                DeviceHttpResponse(200, """
                    {"id":"device-1","name":"Pixel","platform":"android","status":"paired","credentialExpiresAt":null,"revokedAt":null,"sourceConfig":{"expectedRevision":4,"mappings":[]},"revision":4}
                """.trimIndent())
            },
        )

        val result = repository.replaceSourceConfig(
            DeviceSourceConfig(
                expectedRevision = 3,
                mappings = listOf(SourceMapping("boc", "account-1", listOf("CNY"), InstrumentHint("card_suffix", "1234"))),
            ),
        )

        assertEquals("PUT", request?.method)
        assertEquals("https://pf.example/api/mobile/v1/devices/self/source-config", request?.url)
        val body = request?.body?.toString(Charsets.UTF_8).orEmpty()
        assertTrue(body.contains("\"expectedRevision\":3"))
        assertTrue(body.contains("\"sourceProfileId\":\"boc\""))
        assertTrue(body.contains("\"instrumentHint\":{\"kind\":\"card_suffix\",\"value\":\"1234\"}"))
        assertTrue(!body.contains("token", ignoreCase = true))
        assertEquals(4, result.revision)
        assertTrue(result.sourceMappings.isEmpty())
    }
}
