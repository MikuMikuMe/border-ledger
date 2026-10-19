package com.lofuyu.borderledger.debug

import android.content.ComponentName
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import java.io.IOException
import java.time.ZoneId
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch

enum class ProbeExportState(val label: String) {
    NOT_STARTED("No metadata export requested."),
    CANCELED("Metadata export canceled; no document was written."),
    SUCCEEDED("Sanitized metadata export completed."),
    FAILED("Metadata export failed; Android could not write the selected document."),
}

/** Debug-only metadata viewer. No notification text or other app payload is rendered. */
class ProbeActivity : ComponentActivity() {
    private lateinit var content: LinearLayout
    private var exportState = ProbeExportState.NOT_STARTED

    private val exportSanitizedMetadata = registerForActivityResult(
        ActivityResultContracts.CreateDocument("text/csv"),
    ) { uri ->
        exportState = if (uri == null) ProbeExportState.CANCELED else writeSanitizedMetadata(uri)
        if (::content.isInitialized) render(ProbeStore.state.value)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(20.dp(), 20.dp(), 20.dp(), 20.dp())
            setBackgroundColor(Color.rgb(243, 239, 230))
        }
        setContentView(ScrollView(this).apply { addView(content) })
        render(ProbeStore.state.value)

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                ProbeStore.state.collect(::render)
            }
        }
    }

    override fun onResume() {
        super.onResume()
        if (::content.isInitialized) render(ProbeStore.state.value)
    }

    private fun render(state: ProbeStoreState) {
        content.removeAllViews()
        content.addText("Notification probe", heading = true)
        content.addText("Debug-only · metadata only", heading = true)
        content.addText("Notification access: ${if (hasListenerAccess()) "granted" else "not granted"}")
        content.addText("Listener: ${if (state.listenerConnected) "connected" else "not connected"}")
        content.addText("Notification access can expose other apps. This probe inspects only WeChat field presence, notification representations, and platform-exposed individual timestamps. It keeps at most 20 metadata rows in memory.")
        content.addText("Source identification: package only (${ProbePreview.APPROVED_PACKAGE}); conversation identity is unavailable.")
        content.addText("Controlled source check: trigger one new alert from the known BOC conversation, confirm that visible source on the device, then compare this package-only row and its timing. This probe cannot prove BOC origin or recover dismissed history.")
        content.addAction("Open notification access settings") {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }
        content.addAction("Export sanitized metadata CSV") {
            exportSanitizedMetadata.launch("border-ledger-probe-metadata.csv")
        }
        content.addText(exportState.label)
        content.addText("No bank source or parser has been verified. Any future demo state is synthetic. Captures here do not prove automatic transaction support.")
        content.addText("Recent metadata (${state.previews.size}/20)", heading = true)
        if (state.previews.isEmpty()) {
            content.addText("No WeChat notification metadata observed in this app session.")
        }
        val deviceZone = ZoneId.systemDefault()
        state.previews.asReversed().forEach { preview ->
            val postedTime = ProbeTimeSummary.from(preview.notificationPostedAt, deviceZone)
            val callbackTime = ProbeTimeSummary.from(preview.callbackAt, deviceZone)
            val representations = preview.representations
            content.addDivider()
            content.addText("Observation: ${preview.observationKind.label}")
            content.addText("Source: ${preview.sourcePackage} · ${preview.sourceIdentification.label} · category: ${preview.category}")
            content.addText("Posted: ${preview.notificationPostedAt} ms · device ${postedTime.deviceTime}")
            content.addText("Callback: ${preview.callbackAt} ms · device ${callbackTime.deviceTime}")
            content.addText("Device timezone: ${postedTime.deviceZone}; Toronto reporting day: ${postedTime.torontoReportingDay}")
            content.addText("Title field: ${if (preview.titlePresent) "present" else "absent"}; body field: ${if (preview.bodyPresent) "present" else "absent"}")
            content.addText("Representations: standard text ${if (representations.standardTextPresent) "present" else "absent"}; big text ${if (representations.bigTextPresent) "present" else "absent"}; text lines ${representations.textLineCount}${if (representations.textLinesTruncated) "+" else ""}")
            content.addText("Messaging representation: ${if (representations.messagingRepresentationPresent) "present" else "absent"}; messages ${representations.messagingMessageCount}${if (representations.messagingMessagesTruncated) "+" else ""}")
            content.addText(
                if (representations.individualTimestampInspectionAvailable) {
                    "Individual timestamps exposed: ${representations.individualTimestampCount}" +
                        (representations.individualTimestampMin?.let { min -> "; range ${min}–${representations.individualTimestampMax}" } ?: "")
                } else {
                    "Individual timestamps: unavailable on this Android API path"
                },
            )
        }
    }

    private fun writeSanitizedMetadata(uri: Uri): ProbeExportState = try {
        val output = contentResolver.openOutputStream(uri) ?: return ProbeExportState.FAILED
        output.use { stream -> stream.write(ProbeStore.sanitizedCsv().toByteArray(Charsets.UTF_8)) }
        ProbeExportState.SUCCEEDED
    } catch (_: IOException) {
        ProbeExportState.FAILED
    } catch (_: SecurityException) {
        ProbeExportState.FAILED
    } catch (_: RuntimeException) {
        ProbeExportState.FAILED
    }

    private fun hasListenerAccess(): Boolean {
        val enabled = Settings.Secure.getString(contentResolver, "enabled_notification_listeners") ?: return false
        val expected = ComponentName(this, ProbeNotificationListener::class.java)
        return enabled.split(':').any { ComponentName.unflattenFromString(it) == expected }
    }

    private fun Int.dp(): Int = (this * resources.displayMetrics.density).toInt()

    private fun LinearLayout.addText(value: String, heading: Boolean = false) {
        addView(TextView(this@ProbeActivity).apply {
            text = value
            textSize = if (heading) 20f else 15f
            setTextColor(Color.rgb(24, 32, 31))
            if (heading) setTypeface(typeface, Typeface.BOLD)
            setPadding(0, 0, 0, 12.dp())
        }, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
    }

    private fun LinearLayout.addAction(label: String, action: () -> Unit) {
        addView(Button(this@ProbeActivity).apply {
            text = label
            minHeight = 48.dp()
            setOnClickListener { action() }
        }, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
    }

    private fun LinearLayout.addDivider() {
        addView(android.view.View(this@ProbeActivity).apply {
            setBackgroundColor(Color.rgb(180, 174, 163))
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1.dp()).apply {
            setMargins(0, 8.dp(), 0, 12.dp())
        })
    }
}
