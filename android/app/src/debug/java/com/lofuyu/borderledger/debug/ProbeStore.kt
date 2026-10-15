package com.lofuyu.borderledger.debug

import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf

/** Process-local, bounded diagnostic metadata. No persistence and no log output. */
object ProbeStore {
    private const val capacity = 20
    val previews = mutableStateListOf<ProbePreview>()
    val listenerConnected = mutableStateOf(false)

    fun add(preview: ProbePreview) {
        if (previews.size == capacity) previews.removeAt(0)
        previews.add(preview)
    }

    fun sanitizedCsv(): String = buildString {
        appendLine("source_package,source_identification,observation_kind,notification_posted_at_ms,callback_at_ms,title_present,body_present,category,standard_text_present,big_text_present,text_line_count,text_lines_truncated,messaging_representation_present,messaging_message_count,messaging_messages_truncated,individual_timestamp_inspection_available,individual_timestamp_count,individual_timestamp_min_ms,individual_timestamp_max_ms")
        previews.forEach { appendLine(it.sanitizedCsvRow()) }
    }
}
