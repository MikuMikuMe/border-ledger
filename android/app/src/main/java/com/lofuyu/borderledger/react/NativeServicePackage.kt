package com.lofuyu.borderledger.react

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/** Explicitly registered only in the debug host; production and probe launchers share this native bridge. */
class NativeServicePackage(private val runtime: NativeServiceRuntime): BaseReactPackage() {
    override fun getModule(name: String, context: ReactApplicationContext): NativeModule? = when(name) {
        "NativeSession" -> SessionModule(context,runtime)
        "NativeLedger" -> LedgerModule(context,runtime)
        "NativeRecurring" -> RecurringModule(context,runtime)
        "NativeBudget" -> BudgetModule(context,runtime)
        "NativeAnalysis" -> AnalysisModule(context,runtime)
        "NativeReview" -> ReviewModule(context,runtime)
        "NativeAccounts" -> AccountsModule(context,runtime)
        "NativeCaptureDevices" -> CaptureDevicesModule(context,runtime)
        "NativeFiles" -> FilesModule(context,runtime)
        "NativePreferences" -> PreferencesModule(context,runtime)
        else -> null
    }
    override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
        mapOf("NativeSession" to SessionModule::class.java, "NativeLedger" to LedgerModule::class.java,
            "NativeBudget" to BudgetModule::class.java, "NativeAnalysis" to AnalysisModule::class.java, "NativeRecurring" to RecurringModule::class.java, "NativeReview" to ReviewModule::class.java,
            "NativeAccounts" to AccountsModule::class.java, "NativeCaptureDevices" to CaptureDevicesModule::class.java,
            "NativeFiles" to FilesModule::class.java, "NativePreferences" to PreferencesModule::class.java)
            .mapValues { (name,type) -> ReactModuleInfo(name,type.name,false,false,false,true) }
    }
}
