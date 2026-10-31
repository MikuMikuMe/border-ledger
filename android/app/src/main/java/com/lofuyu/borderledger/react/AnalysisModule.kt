package com.lofuyu.borderledger.react
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.lofuyu.borderledger.react.codegen.NativeAnalysisSpec
class AnalysisModule(context:ReactApplicationContext,private val runtime:NativeServiceRuntime):NativeAnalysisSpec(context) {
    private val bridge=BridgeSupport(runtime)
    override fun invalidate() {bridge.close();super.invalidate()}
    override fun execute(action:String,body:String,promise:Promise)=bridge.call(promise) {
        runtime.container.analysisRepository.execute(action,body)
    }
}
