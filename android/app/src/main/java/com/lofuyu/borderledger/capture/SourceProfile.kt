package com.lofuyu.borderledger.capture

import com.lofuyu.borderledger.parser.InstrumentHint
import com.lofuyu.borderledger.parser.CurrencyRegistry

/**
 * Owner-approved source configuration. A display name is only a bounded
 * filtering hint; package/channel/profile scope is the trust boundary.
 */
enum class SourceProfileKind {
    BOC_CREDIT_CARD,
    CMB_UNSUPPORTED,
    UNSUPPORTED,
}

data class SourceProfile(
    val sourceProfileId: String,
    val packageName: String,
    val channelId: String? = null,
    val approvedSenderNames: Set<String> = emptySet(),
    val sourceKind: SourceProfileKind = SourceProfileKind.UNSUPPORTED,
    val approved: Boolean = false,
    val allowedNotificationCategories: Set<String> = setOf("msg", "status", "email"),
    val allowedCurrencies: Set<String> = CurrencyRegistry.DEFAULT_ENTRIES.keys.toSet(),
    val instrumentHint: InstrumentHint? = null,
    val allowedAndroidUserProfile: String? = null,
    val displayName: String = sourceProfileId,
    val parserVersion: String = "1",
) {
    init {
        require(sourceProfileId.isNotBlank()) { "Source profile id is required." }
        require(packageName.isNotBlank()) { "Source package is required." }
        require(approvedSenderNames.all(String::isNotBlank)) { "Sender hints must be non-blank." }
        val registry = CurrencyRegistry()
        require(allowedCurrencies.all { registry.metadata(it) != null }) {
            "Currency hints must use registered ISO 4217 codes."
        }
    }

    fun matchesPackage(packageName: String): Boolean = this.packageName == packageName

    fun matchesChannel(channelId: String?): Boolean = this.channelId == null || this.channelId == channelId

    fun matchesAndroidUserProfile(userProfile: String): Boolean =
        allowedAndroidUserProfile == null || allowedAndroidUserProfile == userProfile

    /** Sender display names are not cryptographic authenticity. */
    fun matchesSender(senderDisplayName: String?): Boolean = when {
        approvedSenderNames.isEmpty() -> true
        senderDisplayName == null -> false
        else -> approvedSenderNames.any { it.equals(senderDisplayName, ignoreCase = true) }
    }

    fun matchesCategory(category: String): Boolean = allowedNotificationCategories.contains(category)

    companion object {
        /**
         * CMB is intentionally present only as a disabled source-gate record.
         * No package, channel, sender, or notification format is asserted.
         */
        fun disabledCmbCreditCard(): SourceProfile = SourceProfile(
            sourceProfileId = "cmb-credit-card-unsupported",
            packageName = "disabled.cmb.source",
            sourceKind = SourceProfileKind.CMB_UNSUPPORTED,
            approved = false,
            displayName = "CMB alerts (unsupported; sample required)",
            parserVersion = "cmb-disabled-v1",
        )

        /** Synthetic fixture profile only; no real BOC source is asserted by production code. */
        fun syntheticBocCreditCard(
            sourceProfileId: String,
            packageName: String,
            channelId: String?,
            senderDisplayNames: Set<String>,
            instrumentHint: InstrumentHint? = null,
        ): SourceProfile = SourceProfile(
            sourceProfileId = sourceProfileId,
            packageName = packageName,
            channelId = channelId,
            approvedSenderNames = senderDisplayNames,
            sourceKind = SourceProfileKind.BOC_CREDIT_CARD,
            approved = true,
            allowedNotificationCategories = setOf("msg", "status"),
            allowedCurrencies = CurrencyRegistry.DEFAULT_ENTRIES.keys.toSet(),
            instrumentHint = instrumentHint,
            displayName = "Synthetic BOC credit-card alert",
            parserVersion = "boc-credit-card-v1",
        )
    }
}
