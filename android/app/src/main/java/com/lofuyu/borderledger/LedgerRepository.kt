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
        return try {
            val payload = api.readSnapshot()
            if (payload.isEmpty() || payload.size > 2 * 1024 * 1024) return SnapshotRefreshResult.Unavailable
            writeOwnerSnapshot(
                OwnerReadCacheEntry(
                    ownerLedgerId = "personal",
                    snapshotAt = now.toString(),
                    lastAuthenticatedAt = now.toString(),
                    refreshExpiresAt = signedIn.refreshExpiresAt ?: signedIn.expiresAt,
                    payload = payload,
                ),
            )
            SnapshotRefreshResult.Refreshed
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

    suspend fun refreshOwnerReport(query: OwnerReportQuery): ReportRefreshResult {
        ownerSession.state.value as? OwnerSessionState.SignedIn ?: return ReportRefreshResult.NotSignedIn
        val api = ownerLedgerApi ?: return ReportRefreshResult.Unavailable
        return try {
            when (val decoded = LedgerSnapshotDecoder.decodeReportSummary(api.readReport(query), query.includeProvisional)) {
                is LedgerReportDecodeResult.Ready -> ReportRefreshResult.Refreshed(decoded.report)
                is LedgerReportDecodeResult.Unsupported -> ReportRefreshResult.Unavailable
            }
        } catch (_: TransportFailure.Offline) {
            ReportRefreshResult.Offline
        } catch (_: TransportFailure.Unauthorized) {
            readCache.clear()
            ownerSession.markRemoteAuthorizationFailure()
            ReportRefreshResult.Unauthorized
        } catch (_: TransportFailure) {
            ReportRefreshResult.Unavailable
        }
    }

    suspend fun readOwnerTransactions(query: OwnerTransactionQuery = OwnerTransactionQuery()): ActivityRefreshResult {
        ownerSession.state.value as? OwnerSessionState.SignedIn ?: return ActivityRefreshResult.NotSignedIn
        val api = ownerLedgerApi ?: return ActivityRefreshResult.Unavailable
        return try {
            when (val decoded = LedgerSnapshotDecoder.decodeTransactions(api.readTransactions(query))) {
                is LedgerTransactionPageDecodeResult.Ready -> ActivityRefreshResult.Refreshed(decoded.page)
                is LedgerTransactionPageDecodeResult.Unsupported -> ActivityRefreshResult.Unavailable
            }
        } catch (_: TransportFailure.Offline) {
            ActivityRefreshResult.Offline
        } catch (_: TransportFailure.Unauthorized) {
            readCache.clear()
            ownerSession.markRemoteAuthorizationFailure()
            ActivityRefreshResult.Unauthorized
        } catch (_: TransportFailure) {
            ActivityRefreshResult.Unavailable
        }
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
}
