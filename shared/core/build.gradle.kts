import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.android.kotlin.multiplatform.library)
}

kotlin {
    jvmToolchain(17)
    android {
        namespace = "com.lofuyu.borderledger.core"
        compileSdk = 37
        compileSdkMinor = 0
        minSdk = 26
        compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
        withHostTestBuilder {}.configure {}
    }
    iosArm64 { binaries.framework { baseName = "BorderLedgerCore"; isStatic = true } }
    iosSimulatorArm64 { binaries.framework { baseName = "BorderLedgerCore"; isStatic = true } }

    sourceSets {
        commonMain.dependencies { api(libs.kotlinx.coroutines.core) }
        commonTest.dependencies {
            implementation(kotlin("test"))
            implementation(libs.kotlinx.coroutines.test)
        }
    }
}
