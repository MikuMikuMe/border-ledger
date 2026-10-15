package com.lofuyu.borderledger.ui.accounts.devices

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceManagementPresentationTest {
    @Test
    fun sourceScopePresentationRetainsRevisionAndEveryMappingField() {
        val device = MobileDevice(
            id = "device-1",
            name = "Pixel",
            platform = "android",
            status = "paired",
            credentialExpiresAt = null,
            revokedAt = null,
            sourceMappings = listOf(
                SourceMapping(
                    sourceProfileId = "boc",
                    accountId = "account-1",
                    allowedCurrencies = listOf("CNY", "USD"),
                    instrumentHint = InstrumentHint("card_suffix", "1234"),
                ),
            ),
            revision = 7,
        )

        val presentation = device.sourceScopePresentation()

        assertEquals(7, presentation.revision)
        assertEquals(SOURCE_SCOPE_READ_ONLY_REASON, presentation.editabilityMessage)
        assertEquals("boc", presentation.mappings.single().sourceProfileId)
        assertEquals("account-1", presentation.mappings.single().accountId)
        assertEquals("CNY, USD", presentation.mappings.single().currenciesLabel)
        assertEquals("card_suffix: 1234", presentation.mappings.single().instrumentHintLabel)
    }

    @Test
    fun captureActionExplainsItOpensSecureCoordinatorInsteadOfAuthorizingFromDeviceCard() {
        assertEquals("Open secure capture setup", CAPTURE_SETUP_ACTION_LABEL)
        assertTrue(CAPTURE_SETUP_ACTION_DESCRIPTION.contains("existing secure capture coordinator"))
        assertTrue(CAPTURE_SETUP_ACTION_DESCRIPTION.contains("does not authorize or renew capture from this device card"))
    }

    @Test
    fun emptySourceScopeIsExplicitlyImportOnlyAndOffersNoCaptureAction() {
        val device = MobileDevice(
            id = "device-1",
            name = "Pixel",
            platform = "android",
            status = "paired",
            credentialExpiresAt = null,
            revokedAt = null,
            sourceMappings = emptyList(),
            revision = 0,
        )

        assertTrue(SOURCE_SETUP_UNAVAILABLE_REASON.contains("import-only", ignoreCase = true))
        assertTrue(SOURCE_SETUP_UNAVAILABLE_REASON.contains("source setup unavailable", ignoreCase = true))
        assertEquals(false, device.canOpenSecureCaptureSetup())
    }
}
