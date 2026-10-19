package com.lofuyu.borderledger.react

import android.Manifest
import android.content.Intent
import android.os.Build
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.lofuyu.borderledger.bank.PlaidCallbackIdentity
import com.lofuyu.borderledger.bank.PlaidOperationId
import com.lofuyu.borderledger.local.AndroidKeyStoreVault
import com.lofuyu.borderledger.local.FileEncryptedRecordStore
import com.swmansion.rnscreens.fragment.restoration.AutoRemovingFragment
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class NativeHostRecreationTest {
    @Test fun screenRestorationRetainsTheExternalIdentityAndNeverResubmitsItsWrite() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        // RN's debug Metro prompt on Android 17 would pause the host during recreation.
        if (Build.VERSION.SDK_INT >= 37) {
            instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.ACCESS_LOCAL_NETWORK)
        }
        val operationId = "task8_recreate_${UUID.randomUUID().toString().replace("-", "")}"
        val owner = "task8_synthetic_$operationId"
        val fingerprint = "accounts:$operationId"
        // Separate synthetic encrypted test directory, never the app's ledger/session records.
        val records = FileEncryptedRecordStore(context, AndroidKeyStoreVault(), "task8-recreation-test")
        val before = BridgeOperationJournal(records).awaitExternal(BridgeOperationRequest(operationId, "plaid_link", fingerprint, owner))
        val identityField = generateSequence<Class<*>>(ReactNativeActivity::class.java) { it.superclass }
            .firstNotNullOf { host -> host.declaredFields.firstOrNull { it.name == "plaidCallbackIdentity" } }
            .apply { isAccessible = true }
        ActivityScenario.launch<ReactNativeActivity>(Intent(context, ReactNativeActivity::class.java)).use { scenario ->
            var first: ReactNativeActivity? = null
            scenario.onActivity { activity ->
                first = activity
                identityField.set(activity, PlaidCallbackIdentity(PlaidOperationId(operationId)))
                // The default FragmentFactory invokes the forbidden RN Screen constructor.
                val restored = activity.supportFragmentManager.fragmentFactory.instantiate(
                    activity.classLoader, "com.swmansion.rnscreens.ScreenStackFragment",
                )
                assertTrue(restored is AutoRemovingFragment)
            }
            scenario.recreate()
            scenario.onActivity { activity ->
                assertNotSame(first, activity)
                assertEquals(operationId, (identityField.get(activity) as PlaidCallbackIdentity).snapshot()?.value)
            }
        }
        // Reopen the encrypted journal, as a replacement JS runtime does. Reading
        // a pending operation must retain its identity/status and skip submission.
        var submissions = 0
        val recovered = BridgeOperationJournal(FileEncryptedRecordStore(context, AndroidKeyStoreVault(), "task8-recreation-test"))
            .start(BridgeOperationRequest(operationId, "plaid_link", fingerprint, owner)) { submissions++; "must_not_submit" }
        assertEquals(before.operationId, recovered.operationId)
        assertEquals("awaiting_result", recovered.status)
        assertEquals(0, submissions)
    }
}
