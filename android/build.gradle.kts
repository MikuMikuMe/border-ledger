plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.multiplatform) apply false
    alias(libs.plugins.android.kotlin.multiplatform.library) apply false
    id("com.facebook.react.rootproject")
}

// Android library projects consumed through React Native autolinking read
// these shared values from rootProject.ext.
extra["compileSdkVersion"] = 37
extra["targetSdkVersion"] = 36
extra["minSdkVersion"] = 26
extra["kotlinVersion"] = "2.4.21"
extra["REACT_NATIVE_NODE_MODULES_DIR"] = file("../mobile/node_modules/react-native").absolutePath

buildscript {
    dependencies {
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.4.21")
    }
}
