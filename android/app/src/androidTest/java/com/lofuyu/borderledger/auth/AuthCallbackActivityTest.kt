package com.lofuyu.borderledger.auth

import android.content.Intent
import android.net.Uri
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.lofuyu.borderledger.BuildConfig
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AuthCallbackActivityTest {
    @Test fun malformedQueryNamesFinishTheExportedActivity() {
        listOf("sta%=value", "sta%2=value", "sta%GG=value").forEach(::assertCallbackFinishes)
    }

    @Test fun malformedQueryValuesFinishTheExportedActivity() {
        listOf("code=%", "code=%2", "code=%GG", "error_description=%GG").forEach(::assertCallbackFinishes)
    }

    private fun assertCallbackFinishes(query: String) {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val callbackUrl = "${BuildConfig.MOBILE_CALLBACK_SCHEME}://${BuildConfig.MOBILE_CALLBACK_HOST}${BuildConfig.MOBILE_CALLBACK_PATH}"
        val intent = Intent(context, AuthCallbackActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = Uri.parse("$callbackUrl?state=synthetic-unmatched-state&$query")
        }

        ActivityScenario.launch<AuthCallbackActivity>(intent).use { scenario ->
            assertEquals(Lifecycle.State.DESTROYED, scenario.state)
        }
    }
}
