package com.lofuyu.borderledger

import com.lofuyu.borderledger.auth.OwnerSessionState
import com.lofuyu.borderledger.auth.OwnerSessionAuthorizationHandler
import com.lofuyu.borderledger.api.OwnerLedgerApi
import com.lofuyu.borderledger.api.OwnerReportQuery
import com.lofuyu.borderledger.api.OwnerTransactionQuery
import com.lofuyu.borderledger.api.TransportFailure
import com.lofuyu.borderledger.capture.CaptureHealthStore
import com.lofuyu.borderledger.local.OwnerReadCache
import com.lofuyu.borderledger.local.OwnerReadCacheEntry
import com.lofuyu.borderledger.sync.CaptureUploadCoordinator
import com.lofuyu.borderledger.sync.UploadSyncResult
import com.lofuyu.borderledger.ui.ledger.LedgerReport
import com.lofuyu.borderledger.ui.ledger.LedgerReportDecodeResult
import com.lofuyu.borderledger.ui.ledger.LedgerSnapshotDecoder
import com.lofuyu.borderledger.ui.ledger.LedgerTransactionPage
import com.lofuyu.borderledger.ui.ledger.LedgerTransactionPageDecodeResult
import java.time.Instant
import com.lofuyu.borderledger.auth.binding
import com.lofuyu.borderledger.auth.OwnerWork
import kotlinx.coroutines.withContext
import com.lofuyu.borderledger.core.OwnerReadResult
import com.lofuyu.borderledger.core.OwnerReadRequest
import com.lofuyu.borderledger.core.ownerRead

/** Owner-authorized read/cache boundary; capture credentials never enter it. */
class LedgerRepository(
    private val ownerSession: OwnerSessionAuthorizationHandler,
    private val readCache: OwnerReadCache,
    private val uploadCoordinator: CaptureUploadCoordinator,
    private val health: CaptureHealthStore,
    private val ownerLedgerApi: OwnerLedgerApi? = null,
) {
    sealed interface SnapshotRefreshResult {
        data object NotSignedIn : SnapshotRefreshResult
        data object Unavailable : SnapshotRefreshResult
        data object Offline : SnapshotRefreshResult
        data object Unauthorized : SnapshotRefreshResult
        data object Refreshed : SnapshotRefreshResult
    }

    sealed interface ReportRefreshResult {
        data object NotSignedIn : ReportRefreshResult
        data object Unavailable : ReportRefreshResult
        data object Offline : ReportRefreshResult
        data object Unauthorized : ReportRefreshResult
        data class Refreshed(val report: LedgerReport) : ReportRefreshResult
    }

    sealed interface ActivityRefreshResult {
        data object NotSignedIn : ActivityRefreshResult
        data object Unavailable : ActivityRefreshResult
        data object Offline : ActivityRefreshResult
        data object Unauthorized : ActivityRefreshResult
        data class Refreshed(val page: LedgerTransactionPage) : ActivityRefreshResult
    }

    suspend fun readCachedOwnerSnapshot(now: Instant): OwnerReadCacheEntry? {
        if (ownerSession.state.value !is OwnerSessionState.SignedIn) {
            readCache.clear()
            return null
        }
        val expected = ownerSession.binding() ?: return null
        val entry = readCache.readIfUsable(now, expected) ?: return null
        if (ownerSession.binding() != expected) return null
        return entry.also { entry ->
            health.cacheSnapshotRecorded(runCatching { Instant.parse(entry.snapshotAt).toEpochMilli() }.getOrDefault(now.toEpochMilli()), expected)
        }
    }

    suspend fun writeOwnerSnapshot(entry: OwnerReadCacheEntry): Boolean {
        val binding = ownerSession.binding() ?: return false
        if (!entry.belongsTo(binding)) return false
        if (!ownerSession.commitIfCurrent(binding) { readCache.write(entry) }) return false
        if (ownerSession.binding() != binding) return false
        health.cacheSnapshotRecorded(runCatching { Instant.parse(entry.snapshotAt).toEpochMilli() }.getOrDefault(System.currentTimeMillis()), binding)
        return true
    }

    suspend fun refreshOwnerSnapshot(now: Instant = Instant.now()): SnapshotRefreshResult {
        val signedIn = ownerSession.state.value as? OwnerSessionState.SignedIn ?: run {
            readCache.clear()
            return SnapshotRefreshResult.NotSignedIn
        }
        val api = ownerLedgerApi ?: return SnapshotRefreshResult.Unavailable
        return refreshSnapshot(api, signedIn, now)
    }

    private suspend fun refreshSnapshot(
        api: OwnerLedgerApi,
        signedIn: OwnerSessionState.SignedIn,
        now: Instant,
    ): SnapshotRefreshResult {
        return try {
            val binding = signedIn.binding ?: return SnapshotRefreshResult.NotSignedIn
            val payload = withContext(OwnerWork(binding)) { api.readSnapshot() }
            if (ownerSession.binding() != binding) return SnapshotRefreshResult.NotSignedIn
            storeSnapshotResult(payload, signedIn, now)
        } catch (_: TransportFailure.Offline) {
            SnapshotRefreshResult.Offline
        } catch (_: TransportFailure.Unauthorized) {
            if (ownerSession.binding() != signedIn.binding) return SnapshotRefreshResult.NotSignedIn
            readCache.clear()
            ownerSession.markRemoteAuthorizationFailure()
            SnapshotRefreshResult.Unauthorized
        } catch (_: TransportFailure) {
            SnapshotRefreshResult.Unavailable
        }
    }

    private fun OwnerReadCacheEntry.belongsTo(binding: com.lofuyu.borderledger.auth.SessionBinding): Boolean =
        ownerUserId == binding.identity.userId && ownerLedgerId == binding.identity.ledgerId && sessionEpoch == binding.epoch

    private suspend fun storeSnapshotResult(payload: ByteArray, signedIn: OwnerSessionState.SignedIn, now: Instant): SnapshotRefreshResult {
        if (!payload.isUsableSnapshot()) return SnapshotRefreshResult.Unavailable
        return if (writeOwnerSnapshot(snapshotEntry(payload, signedIn, now))) SnapshotRefreshResult.Refreshed else SnapshotRefreshResult.NotSignedIn
    }

    private fun snapshotEntry(
        payload: ByteArray,
        signedIn: OwnerSessionState.SignedIn,
        now: Instant,
    ) = OwnerReadCacheEntry(
        ownerLedgerId = requireNotNull(signedIn.binding).identity.ledgerId,
        ownerUserId = requireNotNull(signedIn.binding).identity.userId,
        sessionEpoch = requireNotNull(signedIn.binding).epoch,
        snapshotAt = now.toString(),
        lastAuthenticatedAt = now.toString(),
        refreshExpiresAt = signedIn.refreshExpiresAt ?: signedIn.expiresAt,
        payload = payload,
    )

    private fun ByteArray.isUsableSnapshot(): Boolean = isNotEmpty() && size <= MAX_SNAPSHOT_BYTES

    suspend fun refreshOwnerReport(query: OwnerReportQuery): ReportRefreshResult {
        return refreshOwnerRead(
            read = { requireNotNull(ownerLedgerApi).readReport(query) },
            decode = { (LedgerSnapshotDecoder.decodeReportSummary(it, query.includeProvisional) as? LedgerReportDecodeResult.Ready)?.report },
            result = ::reportRefreshResult,
        )
    }

    suspend fun readOwnerTransactions(query: OwnerTransactionQuery = OwnerTransactionQuery()): ActivityRefreshResult {
        return refreshOwnerRead(
            read = { requireNotNull(ownerLedgerApi).readTransactions(query) },
            decode = { (LedgerSnapshotDecoder.decodeTransactions(it) as? LedgerTransactionPageDecodeResult.Ready)?.page },
            result = ::activityRefreshResult,
        )
    }

    private suspend fun <Value : Any, Result> refreshOwnerRead(
        read: suspend () -> ByteArray,
        decode: suspend (ByteArray) -> Value?,
        result: (OwnerReadResult<Value>) -> Result,
    ): Result {
        val binding = ownerSession.binding() ?: return result(OwnerReadResult.NotSignedIn)
        val outcome = withContext(OwnerWork(binding)) {
            ownerRead(OwnerReadRequest(
                signedIn = true,
                available = ownerLedgerApi != null,
                unauthorized = { if (ownerSession.binding() == binding) invalidateOwnerAuthorization() },
                read = read,
                decode = decode,
            ))
        }
        return result(if (ownerSession.binding() == binding) outcome else OwnerReadResult.NotSignedIn)
    }

    private fun reportRefreshResult(result: OwnerReadResult<LedgerReport>): ReportRefreshResult = when (result) {
        is OwnerReadResult.Ready -> ReportRefreshResult.Refreshed(result.value)
        OwnerReadResult.NotSignedIn -> ReportRefreshResult.NotSignedIn
        OwnerReadResult.Unavailable -> ReportRefreshResult.Unavailable
        OwnerReadResult.Offline -> ReportRefreshResult.Offline
        OwnerReadResult.Unauthorized -> ReportRefreshResult.Unauthorized
    }

    private fun activityRefreshResult(result: OwnerReadResult<LedgerTransactionPage>): ActivityRefreshResult = when (result) {
        is OwnerReadResult.Ready -> ActivityRefreshResult.Refreshed(result.value)
        OwnerReadResult.NotSignedIn -> ActivityRefreshResult.NotSignedIn
        OwnerReadResult.Unavailable -> ActivityRefreshResult.Unavailable
        OwnerReadResult.Offline -> ActivityRefreshResult.Offline
        OwnerReadResult.Unauthorized -> ActivityRefreshResult.Unauthorized
    }

    private suspend fun invalidateOwnerAuthorization() {
        readCache.clear()
        ownerSession.markRemoteAuthorizationFailure()
    }

    suspend fun syncCapture(): UploadSyncResult {
        val result = uploadCoordinator.sync()
        if (result.invalidatesOwnerReadCache()) readCache.clear()
        return result
    }

    private fun UploadSyncResult.invalidatesOwnerReadCache(): Boolean = when (this) {
        is UploadSyncResult.Completed -> acknowledgementCount > 0
        is UploadSyncResult.Partial -> acknowledgementCount > 0
        is UploadSyncResult.Quarantined -> eventIds.isNotEmpty()
        else -> false
    }

    private companion object {
        const val MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024
    }
}
