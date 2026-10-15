package com.lofuyu.borderledger.ui.accounts.devices

data class SourceMapping(
    val sourceProfileId: String,
    val accountId: String,
    val allowedCurrencies: List<String>,
    val instrumentHint: InstrumentHint? = null,
)

data class InstrumentHint(val kind: String, val value: String)

data class MobileDevice(
    val id: String,
    val name: String,
    val platform: String,
    val status: String,
    val credentialExpiresAt: String?,
    val revokedAt: String?,
    val sourceMappings: List<SourceMapping>,
    val revision: Int,
)

data class DeviceSourceConfig(val expectedRevision: Int, val mappings: List<SourceMapping>)

interface DeviceManagementRepository {
    suspend fun readDevices(): List<MobileDevice>
    suspend fun revoke(deviceId: String)
    suspend fun replaceSourceConfig(config: DeviceSourceConfig): MobileDevice
    suspend fun authorizeCapture(config: DeviceSourceConfig): MobileDevice
}
