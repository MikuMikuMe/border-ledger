pluginManagement {
    includeBuild("../mobile/node_modules/@react-native/gradle-plugin")
    repositories { google(); mavenCentral(); gradlePluginPortal() }
}
plugins { id("com.facebook.react.settings") }
extensions.configure<com.facebook.react.ReactSettingsExtension> {
    autolinkLibrariesFromCommand(
        workingDirectory = file("../mobile"),
        lockFiles = files("../mobile/package.json", "../mobile/package-lock.json", "../mobile/react-native.config.js"),
    )
}
dependencyResolutionManagement {
    // React Native configures Maven repositories for the app and autolinked modules.
    repositoriesMode.set(RepositoriesMode.PREFER_PROJECT)
    repositories { google(); mavenCentral() }
}
rootProject.name = "BorderLedgerAndroid"
include(":app")
include(":sharedCore")
project(":sharedCore").projectDir = file("../shared/core")
includeBuild("../mobile/node_modules/@react-native/gradle-plugin")
