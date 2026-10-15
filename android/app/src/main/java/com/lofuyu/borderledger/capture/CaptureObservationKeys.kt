package com.lofuyu.borderledger.capture

import java.nio.charset.StandardCharsets
import java.security.MessageDigest

/** Durable equivalents of Task 6's tracker keys; no notification object crosses this boundary. */
object CaptureObservationKeys {
    fun logicalMessageKey(message: ObservedBankMessage): String? = message.messageIdentity?.let {
        listOf(message.sourceProfileId, message.androidUserProfile, message.packageName, it).joinToString("|")
    }

    fun contentFingerprint(message: ObservedBankMessage): String {
        val value = listOf(
            message.sourceProfileId,
            message.androidUserProfile,
            message.packageName,
            message.groupKey.orEmpty(),
            message.title.orEmpty(),
            message.text.orEmpty(),
            message.textLines.joinToString("\u001f"),
        ).joinToString("\u001e")
        return MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray(StandardCharsets.UTF_8))
            .joinToString(separator = "") { byte -> "%02x".format(byte) }
    }
}
