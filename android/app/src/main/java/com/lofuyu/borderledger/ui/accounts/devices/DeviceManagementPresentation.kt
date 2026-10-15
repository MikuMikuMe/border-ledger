package com.lofuyu.borderledger.ui.accounts.devices

internal const val SOURCE_SCOPE_READ_ONLY_REASON =
    "Source mappings are shown from the owner device snapshot. Editing is unavailable because this screen is not connected to the revision-aware source-config save coordinator; no changes can be made here."

internal const val SOURCE_SETUP_UNAVAILABLE_REASON =
    "Import-only: source setup unavailable. No approved device source mapping is available for secure capture."

internal const val CAPTURE_SETUP_ACTION_LABEL = "Open secure capture setup"

internal const val CAPTURE_SETUP_ACTION_DESCRIPTION =
    "This opens the existing secure capture coordinator. It does not authorize or renew capture from this device card."

internal data class SourceMappingPresentation(
    val sourceProfileId: String,
    val accountId: String,
    val currenciesLabel: String,
    val instrumentHintLabel: String,
)

internal data class DeviceSourceScopePresentation(
    val revision: Int,
    val editabilityMessage: String,
    val mappings: List<SourceMappingPresentation>,
)

internal fun MobileDevice.canOpenSecureCaptureSetup(): Boolean =
    status == "paired" && revokedAt == null && sourceMappings.isNotEmpty()

internal fun MobileDevice.sourceScopePresentation(): DeviceSourceScopePresentation = DeviceSourceScopePresentation(
    revision = revision,
    editabilityMessage = if (sourceMappings.isEmpty()) SOURCE_SETUP_UNAVAILABLE_REASON else SOURCE_SCOPE_READ_ONLY_REASON,
    mappings = sourceMappings.map { mapping ->
        SourceMappingPresentation(
            sourceProfileId = mapping.sourceProfileId,
            accountId = mapping.accountId,
            currenciesLabel = mapping.allowedCurrencies.ifEmpty { listOf("none reported") }.joinToString(", "),
            instrumentHintLabel = mapping.instrumentHint?.let { hint -> "${hint.kind}: ${hint.value}" } ?: "not specified",
        )
    },
)
