package com.lofuyu.borderledger.local

import com.lofuyu.borderledger.api.RevocationIntent

interface RevocationQueue {
    suspend fun readPendingRevocations(): List<RevocationIntent>
    suspend fun writePendingRevocations(values: List<RevocationIntent>)
}

interface MonitoringController {
    suspend fun pauseMonitoring()
}

interface LocalDataPolicy {
    suspend fun pauseMonitoring()
    suspend fun clearOwnerReadCache()
    suspend fun retainEncryptedOutbox()
    suspend fun queueRevocation(value: RevocationIntent)
    suspend fun pendingRevocationCount(): Int
}
