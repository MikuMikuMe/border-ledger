package com.lofuyu.borderledger.task15

import com.lofuyu.borderledger.local.EncryptedLocalDataPolicy
import com.lofuyu.borderledger.local.EncryptedRecordStore
import com.lofuyu.borderledger.local.LedgerRecord
import com.lofuyu.borderledger.local.MonitoringController
import com.lofuyu.borderledger.local.SecureStorageException
import com.lofuyu.borderledger.local.RevocationQueue
import com.lofuyu.borderledger.api.RevocationGrantType
import com.lofuyu.borderledger.api.RevocationIntent
import com.lofuyu.borderledger.parser.CurrencyRegistry
import com.lofuyu.borderledger.ui.settings.ReportingPreferences
import com.lofuyu.borderledger.ui.settings.ReportingPreferencesRepository
import com.lofuyu.borderledger.ui.settings.ReportingPreferencesUpdate
import com.lofuyu.borderledger.ui.settings.reportingCurrencyOptions
import com.lofuyu.borderledger.ui.settings.SettingsViewModel
import com.lofuyu.borderledger.ui.settings.DeviceDisplayPreferences
import com.lofuyu.borderledger.ui.settings.DeviceFilter
import com.lofuyu.borderledger.ui.theme.AppearanceMode
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.TestScope
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class Task15SettingsTest {
    @Test
    fun reportingPreferencesKeepRevisionConflictsVisible() = runTest {
        val repository = FakePreferencesRepository()
        val viewModel = SettingsViewModel(repository, this)
        viewModel.load()
        runCurrent()
        assertEquals(0, viewModel.state.value.preferences?.revision)

        viewModel.save(ReportingPreferencesUpdate("Asia/Shanghai", 0, "CNY"))
        runCurrent()
        assertEquals(1, viewModel.state.value.preferences?.revision)

        repository.forceRevision(4)
        viewModel.save(ReportingPreferencesUpdate("UTC", 1, null))
        runCurrent()
        assertEquals(4, viewModel.state.value.conflictRevision)
    }

    @Test
    fun deviceLocalThemeAndFilterAreNotSharedReportingPreferences() {
        val local = DeviceDisplayPreferences(AppearanceMode.Dark, DeviceFilter.NeedsReview, reducedMotion = true)
        assertEquals(AppearanceMode.Dark, local.appearanceMode)
        assertEquals(DeviceFilter.NeedsReview, local.filter)
        assertTrue(local.reducedMotion)
        assertEquals(1, ReportingPreferences.DEFAULT.weekStart)
        assertEquals("America/Toronto", ReportingPreferences.DEFAULT.reportingTimezone)
    }

    @Test
    fun sharedPreferredCurrencyUsesTheCompleteRegistryAndRejectsUnknownCodes() {
        val registry = CurrencyRegistry()
        assertEquals("JPY", registry.metadata("JPY")?.code)
        assertEquals(0, registry.metadata("JPY")?.minorUnitDigits)
        assertEquals("TND", registry.metadata("TND")?.code)
        assertEquals(3, registry.metadata("TND")?.minorUnitDigits)
        assertEquals("JPY", ReportingPreferences("America/Toronto", 1, "JPY", 0).preferredCurrency)

        var rejected = false
        try {
            ReportingPreferences("America/Toronto", 1, "ZZZ", 0)
        } catch (_: IllegalArgumentException) {
            rejected = true
        }
        assertTrue(rejected)
    }

    @Test
    fun reportingCurrencySelectorKeepsSourceModeAndUsesOnlyTheSharedRegistry() {
        val options = reportingCurrencyOptions()

        assertNull(options.first())
        assertEquals(CurrencyRegistry.DEFAULT_CODES.size + 1, options.size)
        assertEquals(CurrencyRegistry.DEFAULT_CODES, options.drop(1).toSet())
        assertEquals(listOf(null, "AED", "AFN", "ALL"), options.take(4))
    }

    @Test
    fun offlineSignOutClearsFinancialCacheRetainsOutboxAndQueuesRevocation() = runTest {
        val records = MemoryRecords(
            mutableMapOf(
                LedgerRecord.FINANCIAL_READ_CACHE to byteArrayOf(1),
                LedgerRecord.OUTBOX_QUEUE to byteArrayOf(2),
            ),
        )
        val queue = MemoryRevocations()
        val policy = EncryptedLocalDataPolicy(records, queue, object : MonitoringController {
            override suspend fun pauseMonitoring() = Unit
        })
        policy.clearOwnerReadCache()
        policy.retainEncryptedOutbox()
        policy.queueRevocation(RevocationIntent(RevocationGrantType.OwnerFamily, 2, "offline-capability", "2026-10-14T12:00:00Z"))

        assertNull(records.values[LedgerRecord.FINANCIAL_READ_CACHE])
        assertTrue(records.values[LedgerRecord.OUTBOX_QUEUE]?.contentEquals(byteArrayOf(2)) == true)
        assertEquals(1, policy.pendingRevocationCount())
    }
}

private class FakePreferencesRepository : ReportingPreferencesRepository {
    private var value = ReportingPreferences.DEFAULT

    override suspend fun read(): ReportingPreferences = value

    override suspend fun update(expectedRevision: Int, update: ReportingPreferencesUpdate): ReportingPreferences {
        if (expectedRevision != value.revision) throw ReportingPreferencesRepository.RevisionConflict(value.revision)
        value = ReportingPreferences(update.reportingTimezone, update.weekStart, update.preferredCurrency, value.revision + 1, "2026-10-14T12:00:00Z")
        return value
    }

    fun forceRevision(revision: Int) {
        value = value.copy(revision = revision)
    }
}

private class MemoryRecords(val values: MutableMap<String, ByteArray>) : EncryptedRecordStore {
    override suspend fun read(record: String): ByteArray? = values[record]
    override suspend fun write(record: String, value: ByteArray) { values[record] = value }
    override suspend fun delete(record: String) { values.remove(record) }
}

private class MemoryRevocations : RevocationQueue {
    private var values = emptyList<RevocationIntent>()
    override suspend fun readPendingRevocations(): List<RevocationIntent> = values
    override suspend fun writePendingRevocations(values: List<RevocationIntent>) { this.values = values }
}
