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
        return readCache.readIfUsable(now)?.also { entry ->
            health.cacheSnapshotRecorded(runCatching { Instant.parse(entry.snapshotAt).toEpochMilli() }.getOrDefault(now.toEpochMilli()))
        }
    }

    suspend fun writeOwnerSnapshot(entry: OwnerReadCacheEntry): Boolean {
        if (ownerSession.state.value !is OwnerSessionState.SignedIn) return false
        readCache.write(entry)
        health.cacheSnapshotRecorded(runCatching { Instant.parse(entry.snapshotAt).toEpochMilli() }.getOrDefault(System.currentTimeMillis()))
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
            val payload = api.readSnapshot()
            if (!payload.isUsableSnapshot()) {
                SnapshotRefreshResult.Unavailable
            } else {
                writeOwnerSnapshot(snapshotEntry(payload, signedIn, now))
                SnapshotRefreshResult.Refreshed
            }
        } catch (_: TransportFailure.Offline) {
            SnapshotRefreshResult.Offline
        } catch (_: TransportFailure.Unauthorized) {
            readCache.clear()
            ownerSession.markRemoteAuthorizationFailure()
            SnapshotRefreshResult.Unauthorized
        } catch (_: TransportFailure) {
            SnapshotRefreshResult.Unavailable
        }
    }

    private fun snapshotEntry(
        payload: ByteArray,
        signedIn: OwnerSessionState.SignedIn,
        now: Instant,
    ) = OwnerReadCacheEntry(
        ownerLedgerId = "personal",
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
    ): Result = result(
        ownerRead(
            OwnerReadRequest(
                signedIn = ownerSession.state.value is OwnerSessionState.SignedIn,
                available = ownerLedgerApi != null,
                unauthorized = ::invalidateOwnerAuthorization,
                read = read,
                decode = decode,
            ),
        ),
    )

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
