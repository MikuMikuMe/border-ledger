package com.lofuyu.borderledger.capture

import android.app.Notification
import android.os.Build
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.lofuyu.borderledger.BorderLedgerApplication
import com.lofuyu.borderledger.sync.CaptureUploadScheduler
import com.lofuyu.borderledger.sync.CaptureUploadReconciler
import com.lofuyu.borderledger.sync.UploadScheduleResult
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Production notification boundary. Only bounded scalar copies leave the
 * callback; parsing, encrypted persistence, and scheduler calls run on the
 * service's background scope.
 */
class BankNotificationListenerService : NotificationListenerService() {
    private val connected = AtomicBoolean(false)
    @Volatile
    private var connectionReady: CompletableDeferred<Unit>? = null
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val copier = AndroidNotificationSnapshotCopier { System.currentTimeMillis() }

    override fun onListenerConnected() {
        val runtime = runtimeOrNull() ?: return
        connected.set(true)
        val ready = CompletableDeferred<Unit>()
        connectionReady = ready
        runtime.health.refresh(this, BankNotificationListenerService::class.java)
        runtime.health.listenerConnected()
        serviceScope.launch {
            // Activation is durable before active notifications are inspected.
            runtime.intake.onListenerConnected()
            val reconciler = CaptureUploadReconciler(runtime.uploadScheduler)
            tryReconcile(runtime) { reconciler.onListenerConnected() }
            ready.complete(Unit)
            val active = runCatching { activeNotifications.toList() }.getOrElse {
                runtime.health.refresh(this@BankNotificationListenerService, BankNotificationListenerService::class.java)
                emptyList()
            }
            active.asSequence()
                .take(MAX_ACTIVE_RECOVERIES)
                .forEach { dispatch(it, ObservationOrigin.ACTIVE_RECOVERY, runtime) }
            // Reconcile again after the active snapshot so a transient first
            // scheduling failure cannot strand already-persisted work.
            tryReconcile(runtime) { reconciler.onListenerConnected() }
        }
    }

    override fun onListenerDisconnected() {
        connected.set(false)
        connectionReady?.cancel()
        connectionReady = null
        runtimeOrNull()?.health?.listenerDisconnected()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (!connected.get()) return
        val runtime = runtimeOrNull() ?: return
        dispatch(sbn, ObservationOrigin.NEW_CALLBACK, runtime)
    }

    override fun onDestroy() {
        connected.set(false)
        connectionReady?.cancel()
        connectionReady = null
        serviceScope.cancel()
        super.onDestroy()
    }

    private fun dispatch(
        sbn: StatusBarNotification,
        origin: ObservationOrigin,
        runtime: BankNotificationListenerRuntime,
    ) {
        // Reject unrelated packages before reading notification extras.
        val profile = runtime.profiles.sourceProfileForPackage(sbn.packageName) ?: return
        val snapshot = copier.copy(sbn, profile, origin) ?: return
        val ready = connectionReady ?: return
        serviceScope.launch {
            ready.await()
            val result = runtime.intake.process(snapshot)
            if (result.requiresUploadScheduling) {
                tryReconcile(runtime) { CaptureUploadReconciler(runtime.uploadScheduler).afterIntake(result) }
            }
        }
    }

    private suspend fun tryReconcile(
        runtime: BankNotificationListenerRuntime,
        block: suspend () -> UploadScheduleResult?,
    ) {
        val result = try {
            block()
        } catch (cancellation: CancellationException) {
            throw cancellation
        } catch (_: Exception) {
            runtime.health.uploadSchedulingFailed("upload_scheduler_exception")
            null
        }
        if (result == UploadScheduleResult.WORK_MANAGER_UNAVAILABLE) {
            // The production scheduler owns the bounded delayed retry. Keep
            // the failure visible here as well so a custom/test scheduler
            // cannot make reconciliation failures look like success.
            runtime.health.uploadSchedulingFailed("work_manager_unavailable")
        }
    }

    private fun runtimeOrNull(): BankNotificationListenerRuntime? =
        (application as? BorderLedgerApplication)?.container?.notificationListenerRuntime

    private companion object {
        const val MAX_ACTIVE_RECOVERIES = 100
    }
}

data class BankNotificationListenerRuntime(
    val profiles: CaptureSourceProfileProvider,
    val health: CaptureHealthStore,
    val intake: BankNotificationIntake,
    val uploadScheduler: CaptureUploadScheduler,
)

/** Copies only fields explicitly modeled by Task 6. Android objects do not cross this boundary. */
class AndroidNotificationSnapshotCopier(
    private val clock: () -> Long,
) {
    fun copy(
        sbn: StatusBarNotification,
        profile: SourceProfile,
        origin: ObservationOrigin,
    ): AndroidNotificationSnapshot? {
        // The caller has already checked the package. Repeat the check here so
        // this reusable copier cannot accidentally inspect an unrelated app.
        if (!profile.matchesPackage(sbn.packageName)) return null
        val notification = sbn.notification
        val extras = notification.extras
        val children = copyMessagingChildren(extras)
        val title = bounded(extras.getCharSequence(Notification.EXTRA_TITLE)?.toString(), NotificationExtractor.MAX_TITLE_CHARS)
        val text = bounded(
            extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
                ?: extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString(),
            NotificationExtractor.MAX_TEXT_CHARS,
        )
        val lines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)
            ?.asSequence()
            ?.take(NotificationExtractor.MAX_TEXT_LINES)
            ?.mapNotNull { bounded(it?.toString(), NotificationExtractor.MAX_LINE_CHARS) }
            ?.toList()
            .orEmpty()
        val userProfile = sbn.user?.toString() ?: "unknown"
        val groupKey = notification.group?.let { bounded(it, NotificationExtractor.MAX_GROUP_CHARS) }
        val isSummary = notification.flags and Notification.FLAG_GROUP_SUMMARY != 0
        val hasIndividualTimestamp = !isSummary && sbn.postTime > 0L
        val capability = when {
            children.isNotEmpty() || text != null || lines.isNotEmpty() -> NotificationContentCapability.BOUNDED_TEXT
            else -> NotificationContentCapability.GENERIC_OS_NOTIFICATION
        }
        return AndroidNotificationSnapshot(
            sourceProfileId = profile.sourceProfileId,
            androidUserProfile = bounded(userProfile, NotificationExtractor.MAX_PROFILE_CHARS).orEmpty(),
            packageName = bounded(sbn.packageName, NotificationExtractor.MAX_PROFILE_CHARS).orEmpty(),
            notificationKey = bounded(sbn.key, NotificationExtractor.MAX_KEY_CHARS).orEmpty(),
            notificationGeneration = 0L,
            notificationPostedAtMillis = sbn.postTime,
            capturedAtMillis = clock(),
            channelId = bounded(notification.channelId, NotificationExtractor.MAX_CHANNEL_CHARS),
            senderDisplayName = title,
            title = title,
            text = text,
            textLines = lines,
            childMessages = children,
            isGroupSummary = isSummary,
            groupKey = groupKey,
            // Android's public notification fields do not establish whether a
            // message came from a private conversation. Keep this unknown so
            // the extractor fails closed before financial parsing.
            isPrivateConversation = null,
            contentCapability = capability,
            notificationCategory = notification.category ?: "unknown",
            origin = origin,
            individualTimestampVerified = hasIndividualTimestamp,
        )
    }

    private fun copyMessagingChildren(extras: android.os.Bundle): List<NotificationMessageSnapshot> {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return emptyList()
        val raw = extras.getParcelableArray(Notification.EXTRA_MESSAGES) ?: return emptyList()
        return runCatching {
            Notification.MessagingStyle.Message.getMessagesFromBundleArray(
                raw.copyOf(raw.size.coerceAtMost(MAX_CHILD_MESSAGES)),
            ).take(MAX_CHILD_MESSAGES).map { message ->
                val timestamp = message.timestamp.takeIf { it > 0L }
                NotificationMessageSnapshot(
                    messageIdentity = timestamp?.let { "timestamp:$it" },
                    postedAtMillis = timestamp,
                    senderDisplayName = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                        message.senderPerson?.name?.toString()
                    } else {
                        message.sender?.toString()
                    },
                    text = bounded(message.text?.toString(), NotificationExtractor.MAX_TEXT_CHARS),
                    title = null,
                )
            }
        }.getOrDefault(emptyList())
    }

    private fun bounded(value: String?, limit: Int): String? = value
        ?.replace('\u0000', ' ')
        ?.trim()
        ?.take(limit)
        ?.takeIf { it.isNotEmpty() }

    private companion object {
        const val MAX_CHILD_MESSAGES = 20
    }
}
