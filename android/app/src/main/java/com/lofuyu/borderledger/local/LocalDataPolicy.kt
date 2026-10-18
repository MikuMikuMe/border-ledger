package com.lofuyu.borderledger.local

import com.lofuyu.borderledger.api.RevocationIntent


/** Logout policy: hide read cache and pause capture while the encrypted outbox survives. */
class EncryptedLocalDataPolicy(
    private val records: EncryptedRecordStore,
    private val revocationQueue: RevocationQueue,
    private val monitoring: MonitoringController,
) : LocalDataPolicy {
    override suspend fun pauseMonitoring() {
        monitoring.pauseMonitoring()
        records.write(LedgerRecord.MONITORING_STATE, "paused".encodeToByteArray())
    }

    override suspend fun clearOwnerReadCache() {
        records.delete(LedgerRecord.FINANCIAL_READ_CACHE)
    }

    override suspend fun retainEncryptedOutbox() {
        // Deliberately no-op: this method documents that logout never clears the outbox.
        records.read(LedgerRecord.OUTBOX_QUEUE)
    }

    override suspend fun queueRevocation(value: RevocationIntent) {
        val current = revocationQueue.readPendingRevocations()
        if (current.none { it.grantType == value.grantType && it.generation == value.generation && it.capability == value.capability }) {
            revocationQueue.writePendingRevocations(current + value)
        }
    }

    override suspend fun pendingRevocationCount(): Int = revocationQueue.readPendingRevocations().size
}
