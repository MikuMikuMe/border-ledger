package com.lofuyu.borderledger.debug

import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.mutableStateOf
import java.io.IOException

enum class ProbeExportState(val label: String) {
    NOT_STARTED("No metadata export requested."),
    CANCELED("Metadata export canceled; no document was written."),
    SUCCEEDED("Sanitized metadata export completed."),
    FAILED("Metadata export failed; Android could not write the selected document."),
}

class ProbeActivity : ComponentActivity() {
    private val exportState = mutableStateOf(ProbeExportState.NOT_STARTED)

    private val exportSanitizedMetadata = registerForActivityResult(
        ActivityResultContracts.CreateDocument("text/csv"),
    ) { uri ->
        exportState.value = if (uri == null) {
            ProbeExportState.CANCELED
        } else {
            writeSanitizedMetadata(uri)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            NotificationProbeScreen(
                permissionGranted = hasListenerAccess(),
                connected = ProbeStore.listenerConnected.value,
                previews = ProbeStore.previews,
                exportState = exportState.value,
                onOpenSettings = { startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) },
                onExport = { exportSanitizedMetadata.launch("border-ledger-probe-metadata.csv") },
            )
        }
    }

    override fun onResume() {
        super.onResume()
        // Recompose after the user returns from Android notification-access settings.
        permissionEpoch.value++
    }

    private val permissionEpoch = androidx.compose.runtime.mutableIntStateOf(0)

    private fun writeSanitizedMetadata(uri: Uri): ProbeExportState = try {
        val output = contentResolver.openOutputStream(uri)
        if (output == null) {
            ProbeExportState.FAILED
        } else {
            output.use { stream ->
                stream.write(ProbeStore.sanitizedCsv().toByteArray(Charsets.UTF_8))
            }
            ProbeExportState.SUCCEEDED
        }
    } catch (_: IOException) {
        ProbeExportState.FAILED
    } catch (_: SecurityException) {
        ProbeExportState.FAILED
    } catch (_: RuntimeException) {
        ProbeExportState.FAILED
    }

    private fun hasListenerAccess(): Boolean {
        permissionEpoch.intValue
        val enabled = Settings.Secure.getString(contentResolver, "enabled_notification_listeners") ?: return false
        val expected = ComponentName(this, ProbeNotificationListener::class.java)
        return enabled.split(':').any { ComponentName.unflattenFromString(it) == expected }
    }
}
