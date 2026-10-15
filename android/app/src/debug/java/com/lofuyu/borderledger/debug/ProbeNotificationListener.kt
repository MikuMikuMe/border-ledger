package com.lofuyu.borderledger.debug

import android.app.Notification
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import java.util.concurrent.atomic.AtomicInteger

class ProbeNotificationListener : NotificationListenerService() {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val pendingUiUpdates = AtomicInteger(0)

    override fun onListenerConnected() {
        mainHandler.post { ProbeStore.listenerConnected.value = true }

        // Active notifications are a reconnect snapshot, not notification history or backfill.
        val active = runCatching { activeNotifications }.getOrElse { emptyArray() }
        var recoveredCount = 0
        for (sbn in active) {
            // Package identity is checked before any notification extras are read.
            if (sbn.packageName != ProbePreview.APPROVED_PACKAGE) continue
            if (recoveredCount == MAX_ACTIVE_RECOVERIES) break
            recoveredCount++
            enqueuePreview(sbn, ProbeObservationKind.RECOVERED_ACTIVE)
        }
    }

    override fun onListenerDisconnected() {
        mainHandler.post { ProbeStore.listenerConnected.value = false }
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        enqueuePreview(sbn, ProbeObservationKind.NEW_CALLBACK)
    }

    private fun enqueuePreview(sbn: StatusBarNotification, observationKind: ProbeObservationKind) {
        // Reject other apps before touching their extras. Do not log or save payloads.
        if (sbn.packageName != ProbePreview.APPROVED_PACKAGE) return
        val notification = sbn.notification
        val extras = notification.extras
        val preview = ProbePreview.from(
            packageName = sbn.packageName,
            postTime = sbn.postTime,
            callbackTime = System.currentTimeMillis(),
            title = extras.getCharSequence(Notification.EXTRA_TITLE),
            body = extras.getCharSequence(Notification.EXTRA_TEXT),
            category = notification.category,
            representations = inspectRepresentations(extras),
            observationKind = observationKind,
        ) ?: return

        // Only bounded scalars cross to the UI thread; no network or database work.
        if (pendingUiUpdates.incrementAndGet() > MAX_PENDING_UI_UPDATES) {
            pendingUiUpdates.decrementAndGet()
            return
        }
        if (!mainHandler.post {
                try {
                    ProbeStore.add(preview)
                } finally {
                    pendingUiUpdates.decrementAndGet()
                }
            }) pendingUiUpdates.decrementAndGet()
    }

    private fun inspectRepresentations(extras: Bundle): NotificationRepresentationSummary {
        val textLines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)
        val rawMessages = extras.getParcelableArray(Notification.EXTRA_MESSAGES)
        val messageCount = rawMessages?.size?.coerceAtMost(NotificationRepresentationSummary.MAX_REPRESENTATION_ITEMS) ?: 0
        val timestampValues = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && rawMessages != null) {
            // Android's public MessagingStyle inspection API starts at API 30. Inspect only a bounded copy.
            Notification.MessagingStyle.Message.getMessagesFromBundleArray(rawMessages.copyOf(messageCount))
                .asSequence()
                .map { it.timestamp }
                .filter { it > 0L }
                .toList()
        } else {
            emptyList()
        }

        return NotificationRepresentationSummary(
            standardTextPresent = !extras.getCharSequence(Notification.EXTRA_TEXT).isNullOrEmpty(),
            bigTextPresent = !extras.getCharSequence(Notification.EXTRA_BIG_TEXT).isNullOrEmpty(),
            textLineCount = textLines?.size?.coerceAtMost(NotificationRepresentationSummary.MAX_REPRESENTATION_ITEMS) ?: 0,
            textLinesTruncated = (textLines?.size ?: 0) > NotificationRepresentationSummary.MAX_REPRESENTATION_ITEMS,
            messagingRepresentationPresent = rawMessages != null,
            messagingMessageCount = messageCount,
            messagingMessagesTruncated = (rawMessages?.size ?: 0) > NotificationRepresentationSummary.MAX_REPRESENTATION_ITEMS,
            individualTimestampInspectionAvailable = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && rawMessages != null,
            individualTimestampCount = timestampValues.size.coerceAtMost(NotificationRepresentationSummary.MAX_REPRESENTATION_ITEMS),
            individualTimestampMin = timestampValues.minOrNull(),
            individualTimestampMax = timestampValues.maxOrNull(),
        )
    }

    private companion object {
        const val MAX_ACTIVE_RECOVERIES = 20
        const val MAX_PENDING_UI_UPDATES = 20
    }
}
