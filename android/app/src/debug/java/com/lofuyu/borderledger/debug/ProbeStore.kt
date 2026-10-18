package com.lofuyu.borderledger.debug

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

data class ProbeStoreState(
    val listenerConnected: Boolean = false,
    val previews: List<ProbePreview> = emptyList(),
)

/** Process-local, bounded diagnostic metadata. No persistence and no log output. */
object ProbeStore {
    private const val capacity = 20
    private val mutableState = MutableStateFlow(ProbeStoreState())
    val state = mutableState.asStateFlow()

    fun setListenerConnected(connected: Boolean) {
        mutableState.update { it.copy(listenerConnected = connected) }
    }

    fun add(preview: ProbePreview) {
        mutableState.update { current ->
            current.copy(previews = (current.previews + preview).takeLast(capacity))
        }
    }

    fun sanitizedCsv(): String = buildString {
        appendLine("source_package,source_identification,observation_kind,notification_posted_at_ms,callback_at_ms,title_present,body_present,category,standard_text_present,big_text_present,text_line_count,text_lines_truncated,messaging_representation_present,messaging_message_count,messaging_messages_truncated,individual_timestamp_inspection_available,individual_timestamp_count,individual_timestamp_min_ms,individual_timestamp_max_ms")
        state.value.previews.forEach { appendLine(it.sanitizedCsvRow()) }
    }
}
