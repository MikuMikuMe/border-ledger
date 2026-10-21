import java.io.File
import java.io.FileInputStream
import java.security.KeyStore
import java.security.MessageDigest

plugins {
    alias(libs.plugins.android.application)
    id("com.facebook.react")
}

extra["REACT_NATIVE_NODE_MODULES_DIR"] = file("../../mobile/node_modules/react-native").absolutePath

react {
    root.set(file("../../mobile"))
    reactNativeDir.set(file("../../mobile/node_modules/react-native"))
    codegenDir.set(file("../../mobile/node_modules/@react-native/codegen"))
    cliFile.set(file("../../mobile/node_modules/react-native/cli.js"))
    autolinkLibrariesWithApp()
}

val requestedReleaseEnvironment = providers.gradleProperty("mobileEnvironment")
val verifyReleaseEnvironment = tasks.register("verifyReleaseEnvironment") {
    group = "verification"
    description = "Require an explicit production environment for release artifacts."
    inputs.property("mobileEnvironment", requestedReleaseEnvironment.orElse(""))
    doLast {
        if (requestedReleaseEnvironment.orNull != "production") {
            throw GradleException("Release builds require -PmobileEnvironment=production; debug defaults to sandbox.")
        }
    }
}
tasks.matching { it.name == "preReleaseBuild" || it.name == "createBundleReleaseJsAndAssets" }.configureEach {
    dependsOn(verifyReleaseEnvironment)
}

val protectedProductionSigningCertificatesSha256 = setOf(
    "5827E817EBAD9D478CA2C3C470A3742D783FC7D2BFBFFB8CC58219B5F3E68417",
    "1FF2A25E39136EEFA79D23CC7531F702B2A162280538410509CA2FF65B4744ED",
)
val verifyDebugSigningIdentity = tasks.register("verifyDebugSigningIdentity") {
    group = "verification"
    description = "Prevent debug artifacts from being signed with a protected production identity."
    doLast {
        val configuredKeystore = providers.gradleProperty("borderLedgerDebugKeystore").orNull
        val keystoreFile = configuredKeystore?.let(::file)
            ?: File(System.getProperty("user.home"), ".android/debug.keystore")

        // On a clean CI runner AGP can generate a new debug keystore. There is
        // no existing identity to reject until that file has been created.
        if (!keystoreFile.isFile) return@doLast

        val storePassword = providers.gradleProperty("borderLedgerDebugKeystorePassword")
            .orElse("android")
            .get()
        val debugKeyAlias = providers.gradleProperty("borderLedgerDebugKeyAlias")
            .orElse("androiddebugkey")
            .get()

        var loadedKeystore: KeyStore? = null
        var lastLoadFailure: Exception? = null
        for (type in listOf("JKS", "PKCS12")) {
            try {
                val candidate = KeyStore.getInstance(type)
                FileInputStream(keystoreFile).use { stream ->
                    candidate.load(stream, storePassword.toCharArray())
                }
                loadedKeystore = candidate
                break
            } catch (failure: Exception) {
                lastLoadFailure = failure
            }
        }
        val keystore = loadedKeystore ?: throw GradleException(
            "Unable to inspect the configured debug keystore. Check its path and store password.",
            lastLoadFailure,
        )
        val certificate = keystore.getCertificate(debugKeyAlias)
            ?: throw GradleException("The configured debug keystore does not contain the selected key alias.")
        val actualFingerprint = MessageDigest.getInstance("SHA-256")
            .digest(certificate.encoded)
            .joinToString("") { byte -> "%02X".format(byte.toInt() and 0xFF) }

        if (actualFingerprint in protectedProductionSigningCertificatesSha256) {
            throw GradleException(
                "Debug packaging refused: its signing certificate is a protected production identity. " +
                    "Configure a separate borderLedgerDebugKeystore."
            )
        }
    }
}
tasks.matching {
    it.name.startsWith("validateSigningDebug") ||
        it.name.startsWith("packageDebug") ||
        it.name.startsWith("signDebug")
}.configureEach {
    dependsOn(verifyDebugSigningIdentity)
}

android {
    namespace = "com.lofuyu.borderledger"
    compileSdk = 37
        compileSdkMinor = 0

    val releaseVersionCode = providers.gradleProperty("releaseVersionCode")
        .map { value -> value.toIntOrNull() ?: throw GradleException("releaseVersionCode must be an integer") }
        .orElse(1000)
    val releaseVersionName = providers.gradleProperty("releaseVersionName")
        .orElse("0.2.0")
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
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "MOBILE_ENVIRONMENT", "\"${mobileEnvironment.get()}\"")
        buildConfigField("String", "MOBILE_API_ORIGIN", "\"https://pf.lofuyu.com\"")
        buildConfigField("String", "MOBILE_CALLBACK_SCHEME", "\"https\"")
        buildConfigField("String", "MOBILE_CALLBACK_HOST", "\"pf.lofuyu.com\"")
        buildConfigField("String", "MOBILE_CALLBACK_PATH", "\"/android/auth/callback\"")
        manifestPlaceholders["mobileCallbackHost"] = "pf.lofuyu.com"
        externalNativeBuild {
            cmake {
                // Hash generated source paths before Windows Ninja reaches MAX_PATH.
                arguments += "-DCMAKE_OBJECT_PATH_MAX=250"
            }
        }
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
        buildConfig = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    externalNativeBuild {
        cmake {
            // Windows callers/CI can keep C++ intermediates on a short D-drive path.
            buildStagingDirectory = file(providers.gradleProperty("borderLedgerCxxRoot").orElse(".cxx"))
        }
    }
    sourceSets.getByName("main").assets.directories.add("../../mobile/assets")
}

dependencies {
    implementation(project(":sharedCore"))
    implementation("com.facebook.react:react-android")
    implementation("com.facebook.react:hermes-android")
    implementation(libs.activity.ktx)
    implementation(libs.lifecycle.runtime.ktx)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.work.runtime.ktx)
    // Official Plaid Link Android SDK; Link is opened through the coordinator boundary.
    implementation(libs.plaid.link.sdk)
    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    // The Android unit-test runtime exposes throwing org.json stubs. Use the
    // platform-neutral implementation for JVM tests; the APK continues to
    // use Android's bundled org.json implementation.
    testImplementation("org.json:json:20231013")
}

