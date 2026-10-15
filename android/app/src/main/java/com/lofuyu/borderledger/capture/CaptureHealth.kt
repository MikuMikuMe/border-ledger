package com.lofuyu.borderledger.capture

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.os.UserManager
import android.provider.Settings
import android.content.pm.PackageManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Runtime capture state is intentionally separate from owner-session state. A
 * missing/expired upload grant must not stop eligible local capture.
 */
data class CaptureHealthState(
    val listenerPermission: ListenerPermission = ListenerPermission.UNKNOWN,
    val listenerConnected: Boolean = false,
    val appPostingNotificationPermission: AppPostingNotificationPermission = AppPostingNotificationPermission.UNKNOWN,
    val firstUnlock: FirstUnlock = FirstUnlock.UNKNOWN,
    val storage: Storage = Storage.UNKNOWN,
    val source: Source = Source.UNKNOWN,
    val intake: Intake = Intake.WAITING_FOR_LISTENER,
    val upload: Upload = Upload.UNKNOWN,
    val pendingCount: Int = 0,
    /** Pending queued identities plus unresolved review/evidence identities. */
    val storedIntakeCount: Int = 0,
    /** Kept as a compatibility name; this is the pending-intake identity limit. */
    val pendingLimit: Int = CaptureIntakeLimits.MAX_STORED_INTAKE_ITEMS,
    val lastFailureCode: String? = null,
    val uploadRetryAttempt: Int = 0,
    val uploadRetryMaxAttempts: Int = 0,
    val uploadRetryAtMillis: Long? = null,
    val uploadFailureCode: String? = null,
    val lastSuccessfulUploadAtMillis: Long? = null,
    val pairingRenewalRequired: Boolean = false,
    val lastCacheSnapshotAtMillis: Long? = null,
) {
    enum class ListenerPermission { UNKNOWN, GRANTED, REVOKED }
    enum class AppPostingNotificationPermission { UNKNOWN, GRANTED, REVOKED }
    enum class FirstUnlock { UNKNOWN, LOCKED, UNLOCKED }
    enum class Storage { UNKNOWN, READY, FAILED }
    enum class Source { UNKNOWN, ELIGIBLE, REVIEW, IGNORED, GENERIC_OR_MUTED }
    enum class Intake { WAITING_FOR_LISTENER, ACTIVE, PAUSED_PENDING_CAP, STORAGE_UNAVAILABLE }
    enum class Upload {
        UNKNOWN,
        READY,
        PAUSED_CAPTURE_CREDENTIAL,
        SCHEDULED,
        RETRY_PENDING,
        RETRY_EXHAUSTED,
    }
}

class CaptureHealthStore(
    private val pendingLimit: Int = CaptureIntakeLimits.MAX_STORED_INTAKE_ITEMS,
) {
    private val _state = MutableStateFlow(CaptureHealthState(pendingLimit = pendingLimit))
    @Volatile private var monitoringPaused = false
    val state: StateFlow<CaptureHealthState> = _state.asStateFlow()

    fun pauseMonitoring() {
        monitoringPaused = true
        _state.value = _state.value.copy(intake = CaptureHealthState.Intake.WAITING_FOR_LISTENER)
    }

    fun monitoringIsPaused(): Boolean = monitoringPaused

    fun refresh(context: Context, serviceClass: Class<*>) {
        val listenerGranted = isListenerEnabled(context, serviceClass)
        val appPermission = if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        ) {
            CaptureHealthState.AppPostingNotificationPermission.GRANTED
        } else {
            CaptureHealthState.AppPostingNotificationPermission.REVOKED
        }
        val unlocked = context.getSystemService(UserManager::class.java)?.isUserUnlocked == true
        _state.value = _state.value.copy(
            listenerPermission = if (listenerGranted) CaptureHealthState.ListenerPermission.GRANTED else CaptureHealthState.ListenerPermission.REVOKED,
            appPostingNotificationPermission = appPermission,
            firstUnlock = if (unlocked) CaptureHealthState.FirstUnlock.UNLOCKED else CaptureHealthState.FirstUnlock.LOCKED,
        )
    }

    fun listenerConnected() {
        _state.value = _state.value.copy(
            listenerPermission = CaptureHealthState.ListenerPermission.GRANTED,
            listenerConnected = true,
        ).withIntakeState()
    }

    fun listenerDisconnected() {
        _state.value = _state.value.copy(
            listenerConnected = false,
            intake = CaptureHealthState.Intake.WAITING_FOR_LISTENER,
        )
    }

    fun storageReady() {
        _state.value = _state.value.copy(
            storage = CaptureHealthState.Storage.READY,
            lastFailureCode = null,
        ).withIntakeState()
    }

    fun storageFailed(code: String = "encrypted_storage_unavailable") {
        _state.value = _state.value.copy(
            storage = CaptureHealthState.Storage.FAILED,
            intake = CaptureHealthState.Intake.STORAGE_UNAVAILABLE,
            lastFailureCode = code,
        )
    }

    fun pendingCount(value: Int) {
        val bounded = value.coerceAtLeast(0)
        _state.value = _state.value.copy(pendingCount = bounded).withIntakeState()
    }

    fun storedIntakeCount(value: Int) {
        _state.value = _state.value.copy(storedIntakeCount = value.coerceAtLeast(0)).withIntakeState()
    }

    fun eligibleSource() {
        _state.value = _state.value.copy(source = CaptureHealthState.Source.ELIGIBLE)
    }

    fun reviewSource() {
        _state.value = _state.value.copy(source = CaptureHealthState.Source.REVIEW)
    }

    fun ignoredSource() {
        _state.value = _state.value.copy(source = CaptureHealthState.Source.IGNORED)
    }

    fun genericOrMutedSource() {
        _state.value = _state.value.copy(source = CaptureHealthState.Source.GENERIC_OR_MUTED)
    }

    fun uploadReady() {
        _state.value = _state.value.copy(
            upload = CaptureHealthState.Upload.READY,
            uploadRetryAttempt = 0,
            uploadRetryMaxAttempts = 0,
            uploadRetryAtMillis = null,
            uploadFailureCode = null,
            pairingRenewalRequired = false,
        )
    }

    fun uploadSucceeded(atMillis: Long) {
        _state.value = _state.value.copy(
            upload = CaptureHealthState.Upload.READY,
            uploadRetryAttempt = 0,
            uploadRetryMaxAttempts = 0,
            uploadRetryAtMillis = null,
            uploadFailureCode = null,
            lastSuccessfulUploadAtMillis = atMillis,
            pairingRenewalRequired = false,
        )
    }

    fun uploadPausedForCredential() {
        _state.value = _state.value.copy(
            upload = CaptureHealthState.Upload.PAUSED_CAPTURE_CREDENTIAL,
            uploadRetryAttempt = 0,
            uploadRetryMaxAttempts = 0,
            uploadRetryAtMillis = null,
            uploadFailureCode = null,
            pairingRenewalRequired = true,
        )
    }

    fun uploadScheduled() {
        _state.value = _state.value.copy(
            upload = CaptureHealthState.Upload.SCHEDULED,
            uploadRetryAttempt = 0,
            uploadRetryMaxAttempts = 0,
            uploadRetryAtMillis = null,
            uploadFailureCode = null,
            pairingRenewalRequired = false,
        )
    }

    fun uploadRetryPending(attempt: Int, maxAttempts: Int, nextRetryAtMillis: Long, code: String = "retryable_upload_failure") {
        _state.value = _state.value.copy(
            upload = CaptureHealthState.Upload.RETRY_PENDING,
            uploadRetryAttempt = attempt.coerceAtLeast(1),
            uploadRetryMaxAttempts = maxAttempts.coerceAtLeast(attempt),
            uploadRetryAtMillis = nextRetryAtMillis,
            uploadFailureCode = code,
        )
    }

    fun uploadRetryExhausted(attempt: Int, maxAttempts: Int) {
        _state.value = _state.value.copy(
            upload = CaptureHealthState.Upload.RETRY_EXHAUSTED,
            uploadRetryAttempt = attempt.coerceAtLeast(1),
            uploadRetryMaxAttempts = maxAttempts.coerceAtLeast(attempt),
            uploadRetryAtMillis = null,
            uploadFailureCode = "work_manager_unavailable",
        )
    }

    fun uploadSchedulingFailed(code: String = "upload_scheduler_unavailable") {
        _state.value = _state.value.copy(uploadFailureCode = code)
    }

    fun cacheSnapshotRecorded(snapshotAtMillis: Long) {
        _state.value = _state.value.copy(lastCacheSnapshotAtMillis = snapshotAtMillis)
    }

    private fun isListenerEnabled(context: Context, serviceClass: Class<*>): Boolean {
        val configured = Settings.Secure.getString(
            context.contentResolver,
            "enabled_notification_listeners",
        ).orEmpty()
        val expected = ComponentName(context, serviceClass)
        return configured.split(':')
            .mapNotNull { ComponentName.unflattenFromString(it) }
            .any { it == expected }
    }

    private fun CaptureHealthState.withIntakeState(): CaptureHealthState = copy(
        intake = when {
            storage == CaptureHealthState.Storage.FAILED -> CaptureHealthState.Intake.STORAGE_UNAVAILABLE
            !listenerConnected -> CaptureHealthState.Intake.WAITING_FOR_LISTENER
            storedIntakeCount >= pendingLimit -> CaptureHealthState.Intake.PAUSED_PENDING_CAP
            else -> CaptureHealthState.Intake.ACTIVE
        },
    )
}

object CaptureIntakeLimits {
    /** The cap applies to unacknowledged queued identities and unresolved review/evidence identities. */
    const val MAX_STORED_INTAKE_ITEMS = 5_000
    const val MAX_PENDING_EVENTS = MAX_STORED_INTAKE_ITEMS
    const val MAX_BATCH_EVENTS = 50
    const val MAX_BATCH_BYTES = 128 * 1024
    const val ACKNOWLEDGED_EVIDENCE_RETENTION_MILLIS = 24L * 60L * 60L * 1_000L
    const val UNRESOLVED_DIAGNOSTIC_RETENTION_MILLIS = 7L * 24L * 60L * 60L * 1_000L
    const val REPLAY_METADATA_RETENTION_MILLIS = 90L * 24L * 60L * 60L * 1_000L
}
