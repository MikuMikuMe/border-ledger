package com.lofuyu.borderledger.ui.settings

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Test

class SettingsViewModelTest {
    @Test
    fun aSlowLoadCannotOverwriteAnewerLoad() {
        val firstStarted = CountDownLatch(1)
        val releaseFirst = CountDownLatch(1)
        val repository = object : ReportingPreferencesRepository {
            var reads = 0
            override suspend fun read(): ReportingPreferences {
                reads += 1
                if (reads == 1) {
                    firstStarted.countDown()
                    releaseFirst.await(2, TimeUnit.SECONDS)
                    return ReportingPreferences.DEFAULT.copy(preferredCurrency = "CAD")
                }
                return ReportingPreferences.DEFAULT.copy(preferredCurrency = "JPY")
            }

            override suspend fun update(expectedRevision: Int, update: ReportingPreferencesUpdate): ReportingPreferences =
                ReportingPreferences.DEFAULT
        }
        val viewModel = SettingsViewModel(repository)

        viewModel.load()
        firstStarted.await(2, TimeUnit.SECONDS)
        viewModel.load()
        Thread.sleep(100)
        releaseFirst.countDown()
        Thread.sleep(200)

        assertEquals("JPY", viewModel.state.value.preferences?.preferredCurrency)
    }
}
