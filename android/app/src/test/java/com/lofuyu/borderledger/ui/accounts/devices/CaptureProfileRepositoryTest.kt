package com.lofuyu.borderledger.ui.accounts.devices

import com.lofuyu.borderledger.auth.CaptureProfileLoadResult
import com.lofuyu.borderledger.auth.CaptureProfileUnavailableReason
import com.lofuyu.borderledger.capture.MutableSourceProfileRegistry
import com.lofuyu.borderledger.capture.SourceProfile
import com.lofuyu.borderledger.capture.SourceProfileKind
import com.lofuyu.borderledger.parser.CurrencyRegistry
import com.lofuyu.borderledger.parser.InstrumentHint as ParserInstrumentHint
import com.lofuyu.borderledger.parser.InstrumentHintKind
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Test

class CaptureProfileRepositoryTest {
    @Test
    fun sourceProfilesRejectUnknownAllowedCurrencies() {
        assertThrows(IllegalArgumentException::class.java) {
            SourceProfile(
                sourceProfileId = "invalid-currency-profile",
                packageName = "com.example.bank",
                allowedCurrencies = setOf("XYZ"),
            )
        }
    }

    @Test
    fun ownerDeviceMappingLoadsOnlyWhenItMatchesAnApprovedSupportedLocalProfile() = runTest {
        val registeredCurrencies = CurrencyRegistry.DEFAULT_ENTRIES.keys.toList()
        val localProfile = SourceProfile.syntheticBocCreditCard(
            sourceProfileId = "boc",
            packageName = "com.example.bank",
            channelId = "alerts",
            senderDisplayNames = setOf("Bank"),
        )
        val repository = DeviceCaptureProfileRepository(
            devices = FakeDeviceManagementRepository(
                MobileDevice(
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
                            allowedCurrencies = registeredCurrencies,
                        ),
                    ),
                    revision = 4,
                ),
            ),
            deviceId = "device-1",
            localProfiles = MutableSourceProfileRegistry().apply { register(localProfile) },
        )

        val result = repository.load()

        assertTrue(result is CaptureProfileLoadResult.Available)
        val profile = (result as CaptureProfileLoadResult.Available).profiles.single()
        assertEquals("boc", profile.sourceProfileId)
        assertEquals("account-1", profile.accountId)
        assertEquals(registeredCurrencies, profile.currencies)
        assertEquals("Approved source mapping", profile.instrumentLabel)
    }

    @Test
    fun unrecognizedServerCurrencyIsNotSilentlyDroppedFromOwnerConsent() = runTest {
        val localProfile = SourceProfile.syntheticBocCreditCard(
            sourceProfileId = "boc",
            packageName = "com.example.bank",
            channelId = "alerts",
            senderDisplayNames = setOf("Bank"),
        )
        val repository = DeviceCaptureProfileRepository(
            devices = FakeDeviceManagementRepository(
                MobileDevice(
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
                            allowedCurrencies = listOf(CurrencyRegistry.DEFAULT_ENTRIES.keys.first(), "ZZZ"),
                        ),
                    ),
                    revision = 4,
                ),
            ),
            deviceId = "device-1",
            localProfiles = MutableSourceProfileRegistry().apply { register(localProfile) },
        )

        val result = repository.load()

        assertEquals(
            CaptureProfileLoadResult.Unavailable(CaptureProfileUnavailableReason.SourceProfileUnavailable),
            result,
        )
    }

    @Test
    fun boundedHintedMappingLoadsForCaptureAuthorization() = runTest {
        val localProfile = SourceProfile.syntheticBocCreditCard(
            sourceProfileId = "boc",
            packageName = "com.example.bank",
            channelId = "alerts",
            senderDisplayNames = setOf("Bank"),
            instrumentHint = ParserInstrumentHint(InstrumentHintKind.CARD_SUFFIX, "1234"),
        )
        val repository = DeviceCaptureProfileRepository(
            devices = FakeDeviceManagementRepository(
                MobileDevice(
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
                            allowedCurrencies = CurrencyRegistry.DEFAULT_ENTRIES.keys.toList(),
                            instrumentHint = InstrumentHint("card_suffix", "1234"),
                        ),
                    ),
                    revision = 4,
                ),
            ),
            deviceId = "device-1",
            localProfiles = MutableSourceProfileRegistry().apply { register(localProfile) },
        )

        val result = repository.load()

        assertTrue(result is CaptureProfileLoadResult.Available)
        val profile = (result as CaptureProfileLoadResult.Available).profiles.single()
        assertEquals("card_suffix: 1234", profile.instrumentLabel)
        assertEquals("card_suffix", profile.instrumentHint?.kind)
        assertEquals("1234", profile.instrumentHint?.value)
    }

    @Test
    fun sameAccountCurrencyCanRepresentTwoIndependentlyHintedInstruments() = runTest {
        val localProfile = SourceProfile.syntheticBocCreditCard(
            sourceProfileId = "boc",
            packageName = "com.example.bank",
            channelId = "alerts",
            senderDisplayNames = setOf("Bank"),
        )
        val repository = DeviceCaptureProfileRepository(
            devices = FakeDeviceManagementRepository(
                MobileDevice(
                    id = "device-1",
                    name = "Pixel",
                    platform = "android",
                    status = "paired",
                    credentialExpiresAt = null,
                    revokedAt = null,
                    sourceMappings = listOf(
                        SourceMapping("boc", "account-1", listOf("CNY"), InstrumentHint("card_suffix", "1234")),
                        SourceMapping("boc", "account-1", listOf("CNY"), InstrumentHint("card_suffix", "5678")),
                    ),
                    revision = 8,
                ),
            ),
            deviceId = "device-1",
            localProfiles = MutableSourceProfileRegistry().apply { register(localProfile) },
        )

        val result = repository.load()

        assertTrue(result is CaptureProfileLoadResult.Available)
        val profiles = (result as CaptureProfileLoadResult.Available).profiles
        assertEquals(2, profiles.size)
        assertEquals(setOf("1234", "5678"), profiles.mapNotNull { it.instrumentHint?.value }.toSet())
    }

    @Test
    fun mismatchedInstrumentMappingRemainsImportOnly() = runTest {
        val localProfile = SourceProfile.syntheticBocCreditCard(
            sourceProfileId = "boc",
            packageName = "com.example.bank",
            channelId = "alerts",
            senderDisplayNames = setOf("Bank"),
            instrumentHint = ParserInstrumentHint(InstrumentHintKind.CARD_SUFFIX, "1234"),
        )
        val repository = DeviceCaptureProfileRepository(
            devices = FakeDeviceManagementRepository(
                MobileDevice(
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
                            allowedCurrencies = CurrencyRegistry.DEFAULT_ENTRIES.keys.toList(),
                            instrumentHint = InstrumentHint("card_suffix", "9999"),
                        ),
                    ),
                    revision = 4,
                ),
            ),
            deviceId = "device-1",
            localProfiles = MutableSourceProfileRegistry().apply { register(localProfile) },
        )

        val result = repository.load()

        assertEquals(
            CaptureProfileLoadResult.Unavailable(CaptureProfileUnavailableReason.SourceProfileUnavailable),
            result,
        )
    }

    @Test
    fun unknownOrCmbMappingRemainsImportOnly() = runTest {
        val cmb = SourceProfile.disabledCmbCreditCard()
        val repository = DeviceCaptureProfileRepository(
            devices = FakeDeviceManagementRepository(
                MobileDevice(
                    id = "device-1",
                    name = "Pixel",
                    platform = "android",
                    status = "paired",
                    credentialExpiresAt = null,
                    revokedAt = null,
                    sourceMappings = listOf(SourceMapping(cmb.sourceProfileId, "account-1", listOf(CurrencyRegistry.DEFAULT_ENTRIES.keys.first()))),
                    revision = 1,
                ),
            ),
            deviceId = "device-1",
            localProfiles = MutableSourceProfileRegistry().apply { register(cmb) },
        )

        val result = repository.load()

        assertTrue(result is CaptureProfileLoadResult.Unavailable)
        assertEquals(SourceProfileKind.CMB_UNSUPPORTED, cmb.sourceKind)
    }
}

private class FakeDeviceManagementRepository(
    private val device: MobileDevice,
) : DeviceManagementRepository {
    override suspend fun readDevices(): List<MobileDevice> = listOf(device)
    override suspend fun revoke(deviceId: String) = Unit
    override suspend fun replaceSourceConfig(config: DeviceSourceConfig): MobileDevice = device
    override suspend fun authorizeCapture(config: DeviceSourceConfig): MobileDevice = device
}
