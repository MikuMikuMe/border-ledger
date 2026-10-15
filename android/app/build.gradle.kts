plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.lofuyu.borderledger"
    compileSdk = 36

    val releaseVersionCode = providers.gradleProperty("releaseVersionCode")
        .map { value -> value.toIntOrNull() ?: throw GradleException("releaseVersionCode must be an integer") }
        .orElse(1)
    val releaseVersionName = providers.gradleProperty("releaseVersionName")
        .orElse("0.1-foundation")
    val mobileEnvironment = providers.gradleProperty("mobileEnvironment")
        .map { value ->
            value.trim().also {
                if (it != "sandbox" && it != "production") {
                    throw GradleException("mobileEnvironment must be sandbox or production")
                }
            }
        }
        .orElse("sandbox")

    defaultConfig {
        applicationId = "com.lofuyu.borderledger"
        minSdk = 26
        targetSdk = 36
        versionCode = releaseVersionCode.get()
        versionName = releaseVersionName.get()
        buildConfigField("String", "MOBILE_ENVIRONMENT", "\"${mobileEnvironment.get()}\"")
        buildConfigField("String", "MOBILE_API_ORIGIN", "\"https://pf.lofuyu.com\"")
        buildConfigField("String", "MOBILE_CALLBACK_SCHEME", "\"https\"")
        buildConfigField("String", "MOBILE_CALLBACK_HOST", "\"pf.lofuyu.com\"")
        buildConfigField("String", "MOBILE_CALLBACK_PATH", "\"/android/auth/callback\"")
        manifestPlaceholders["mobileCallbackHost"] = "pf.lofuyu.com"
    }
    buildTypes {
        getByName("debug") {
            applicationIdSuffix = ".probe"
            val localDebugKeystore = providers.gradleProperty("borderLedgerDebugKeystore").orNull
            if (localDebugKeystore != null) {
                signingConfig = signingConfigs.create("localDebug") {
                    storeFile = file(localDebugKeystore)
                    storePassword = providers.gradleProperty("borderLedgerDebugKeystorePassword").orNull ?: "android"
                    keyAlias = providers.gradleProperty("borderLedgerDebugKeyAlias").orNull ?: "androiddebugkey"
                    keyPassword = providers.gradleProperty("borderLedgerDebugKeyPassword").orNull ?: "android"
                }
            }
        }
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

// Keep the existing Kotlin tests under the conventional Android `java` test
// source directory visible to the Kotlin 2.x compiler as well as AGP.
kotlin {
    sourceSets.all {
        if (name.contains("test", ignoreCase = true)) {
            kotlin.srcDir("src/test/java")
        }
    }
}

// AGP/Kotlin 2.x can otherwise omit Kotlin files stored in the Android
// `src/test/java` convention directory from the variant compile task.
tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
    if (name.endsWith("UnitTestKotlin")) {
        source(fileTree("src/test/java") { include("**/*.kt") })
        // This shared synthetic fixture is referenced by parser, capture and
        // local-store tests. Keep it explicit because the WebDAV-backed
        // checkout can otherwise omit this newly-added source from the
        // incremental Kotlin source snapshot.
        source(file("src/test/java/com/lofuyu/borderledger/capture/SyntheticNotificationFixtures.kt"))
    }
}

dependencies {
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons.extended)
    implementation(libs.activity.compose)
    implementation(libs.lifecycle.runtime.ktx)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.work.runtime.ktx)
    // Official Plaid Link Android SDK; Link is opened through the coordinator boundary.
    implementation(libs.plaid.link.sdk)
    debugImplementation(libs.compose.ui.tooling)
    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    // The Android unit-test runtime exposes throwing org.json stubs. Use the
    // platform-neutral implementation for JVM tests; the APK continues to
    // use Android's bundled org.json implementation.
    testImplementation("org.json:json:20231013")
}

