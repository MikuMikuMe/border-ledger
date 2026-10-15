package com.lofuyu.borderledger.exports

import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import com.lofuyu.borderledger.parser.CurrencyRegistry
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.OutputStream
import java.nio.charset.StandardCharsets
import java.time.LocalDate
import java.time.format.DateTimeParseException
import java.util.Locale
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext

const val CANONICAL_LEDGER_HEADER: String =
    "Id,AccountId,Date,Merchant,Category,Kind,Status,Source,AmountMinor,Currency,Note,Fingerprint,BankReference\n"

/** Worker-supported selection modes; the native screen currently exposes only [All]. */
enum class ExportSelection(val wireValue: String) {
    All("all"),
    CurrentFilter("current_filter"),
}

data class LedgerExportFilters(
    val currency: String? = null,
    val startDate: String? = null,
    val endDate: String? = null,
) {
    val isEmpty: Boolean get() = currency == null && startDate == null && endDate == null
}

data class LedgerExportRequest(
    val selection: ExportSelection,
    val filters: LedgerExportFilters = LedgerExportFilters(),
)

data class LedgerExportRow(
    val id: String,
    val accountId: String,
    val date: String,
    val merchant: String,
    val category: String,
    val kind: String,
    val status: String,
    val source: String,
    val amountMinor: Long,
    val currency: String,
    val note: String? = null,
    val fingerprint: String,
    val bankReference: String? = null,
)

data class WorkerExportReceipt(
    val receiptId: String,
    val exportedRows: Int,
    val issuedAt: String? = null,
) {
    init {
        require(receiptId.isNotBlank()) { "A Worker export receipt must have an ID." }
        require(exportedRows >= 0) { "A Worker export receipt must have a non-negative row count." }
    }
}

data class ExportFailure(
    val code: String,
    val message: String,
    val retryable: Boolean = false,
)

enum class ExportHandoff {
    Save,
    Share,
}

/** Owner-authenticated stream boundary. It must return a Worker receipt after the stream. */
interface OwnerLedgerExportGateway {
    suspend fun streamLedgerCsv(
        request: LedgerExportRequest,
        sink: suspend (ByteArray) -> Unit,
    ): WorkerExportReceipt?
}

interface ExportDestination {
    val uri: Uri
    fun openOutputStream(): OutputStream
    fun delete(): Boolean
}

class ContentResolverExportDestination(
    private val resolver: ContentResolver,
    override val uri: Uri,
) : ExportDestination {
    override fun openOutputStream(): OutputStream = resolver.openOutputStream(uri)
        ?: throw IOException("Android could not open the selected export destination.")

    override fun delete(): Boolean = resolver.delete(uri, null, null) > 0
}

sealed interface ExportState {
    data object Idle : ExportState
    data class Streaming(val request: LedgerExportRequest, val destinationUri: Uri) : ExportState
    data class AwaitingWorkerReceipt(
        val request: LedgerExportRequest,
        val destinationUri: Uri,
        val bytesWritten: Long,
        val handoff: ExportHandoff,
    ) : ExportState
    data class Completed(
        val request: LedgerExportRequest,
        val destinationUri: Uri,
        val bytesWritten: Long,
        val handoff: ExportHandoff,
        val receipt: WorkerExportReceipt,
    ) : ExportState
    data object Cancelled : ExportState
    data class Error(
        val request: LedgerExportRequest?,
        val failure: ExportFailure,
    ) : ExportState
}

/**
 * Streams the Worker response directly into the owner-selected SAF destination. A
 * missing Worker receipt is intentionally represented as pending, never as success.
 */
class LedgerExportCoordinator(
    private val gateway: OwnerLedgerExportGateway,
) {
    private val _state = MutableStateFlow<ExportState>(ExportState.Idle)
    val state: StateFlow<ExportState> = _state.asStateFlow()

    suspend fun export(
        request: LedgerExportRequest,
        destination: ExportDestination,
        handoff: ExportHandoff,
    ): ExportState {
        val validation = validate(request)
        if (validation != null) {
            _state.value = ExportState.Error(request, validation)
            return _state.value
        }
        _state.value = ExportState.Streaming(request, destination.uri)
        return try {
            val result = withContext(Dispatchers.IO) {
                var bytesWritten = 0L
                val prefix = ByteArrayOutputStream(CANONICAL_LEDGER_HEADER.toByteArray(StandardCharsets.UTF_8).size)
                val headerBytes = CANONICAL_LEDGER_HEADER.toByteArray(StandardCharsets.UTF_8)
                val output = destination.openOutputStream().buffered()
                try {
                    val receipt = gateway.streamLedgerCsv(request) { chunk ->
                        if (chunk.isNotEmpty()) {
                            val remaining = headerBytes.size - prefix.size()
                            if (remaining > 0) prefix.write(chunk, 0, minOf(remaining, chunk.size))
                            output.write(chunk)
                            bytesWritten += chunk.size
                        }
                    } ?: throw MissingWorkerReceiptException(bytesWritten)
                    output.flush()
                    if (!prefix.toByteArray().contentEquals(headerBytes)) throw InvalidExportException
                    ExportWriteResult(bytesWritten, receipt)
                } finally {
                    output.close()
                }
            }
            val current = if (result.receipt.receiptId.isBlank()) {
                ExportState.AwaitingWorkerReceipt(request, destination.uri, result.bytesWritten, handoff)
            } else {
                ExportState.Completed(request, destination.uri, result.bytesWritten, handoff, result.receipt)
            }
            _state.value = current
            current
        } catch (error: CancellationException) {
            runCatching { destination.delete() }
            _state.value = ExportState.Cancelled
            throw error
        } catch (error: MissingWorkerReceiptException) {
            // The file is intentionally retained in the user-selected location, but the
            // UI remains in an explicit pending state and cannot call this an export success.
            val pending = ExportState.AwaitingWorkerReceipt(request, destination.uri, error.bytesWritten, handoff)
            _state.value = pending
            pending
        } catch (error: InvalidExportException) {
            runCatching { destination.delete() }
            val failure = ExportFailure("invalid_worker_csv", "The Worker returned a non-canonical CSV; no export was reported.")
            _state.value = ExportState.Error(request, failure)
            _state.value
        } catch (error: Exception) {
            runCatching { destination.delete() }
            val failure = ExportFailure("export_failed", error.message ?: "The export could not be written.", retryable = true)
            _state.value = ExportState.Error(request, failure)
            _state.value
        }
    }

    fun createSaveDocumentIntent(fileName: String = "border-ledger-export.csv"): Intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
        .addCategory(Intent.CATEGORY_OPENABLE)
        .setType("text/csv")
        .putExtra(Intent.EXTRA_TITLE, safeFileName(fileName))

    fun createShareIntent(uri: Uri): Intent = Intent(Intent.ACTION_SEND)
        .setType("text/csv")
        .putExtra(Intent.EXTRA_STREAM, uri)
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)

    /** Used when the document picker/share sheet is canceled before streaming starts. */
    fun markCancelled() {
        _state.value = ExportState.Cancelled
    }

    private fun validate(request: LedgerExportRequest): ExportFailure? {
        val currency = request.filters.currency
        if (currency != null && CurrencyRegistry().metadata(currency) == null) return ExportFailure("invalid_currency", "Choose a registered ISO currency filter.")
        val startDate = request.filters.startDate
        val endDate = request.filters.endDate
        if (startDate != null && !isDate(startDate)) return ExportFailure("invalid_start_date", "The export start date is not valid.")
        if (endDate != null && !isDate(endDate)) return ExportFailure("invalid_end_date", "The export end date is not valid.")
        if (startDate != null && endDate != null && startDate > endDate) return ExportFailure("invalid_date_range", "The export date range is not valid.")
        return null
    }

    private fun isDate(value: String): Boolean = try {
        LocalDate.parse(value)
        true
    } catch (_: DateTimeParseException) {
        false
    }

    private fun safeFileName(value: String): String {
        val trimmed = value.trim().ifBlank { "border-ledger-export.csv" }
        val safe = trimmed.replace(Regex("[^A-Za-z0-9._-]"), "_")
        return if (safe.lowercase(Locale.ROOT).endsWith(".csv")) safe else "$safe.csv"
    }

    private data class ExportWriteResult(val bytesWritten: Long, val receipt: WorkerExportReceipt)

    private class MissingWorkerReceiptException(val bytesWritten: Long) : Exception()
    private object InvalidExportException : Exception()

    private companion object {
    }
}

fun canonicalCsvCell(value: String?, numeric: Boolean = false): String {
    if (value == null) return ""
    if (numeric) return value
    val safe = value.replace(FormulaLikeSegment) { match ->
        "${match.groupValues[1]}'${match.groupValues[2]}"
    }
    val quoted = safe.any { character ->
        character == ',' || character == '"' || character == '\r' || character == '\n' || character.code > 0x7F
    }
    return if (quoted) "\"${safe.replace("\"", "\"\"")}\"" else safe
}

fun canonicalLedgerCsvRow(row: LedgerExportRow): String = listOf(
    canonicalCsvCell(row.id),
    canonicalCsvCell(row.accountId),
    canonicalCsvCell(row.date),
    canonicalCsvCell(row.merchant),
    canonicalCsvCell(row.category),
    canonicalCsvCell(row.kind),
    canonicalCsvCell(row.status),
    canonicalCsvCell(row.source),
    canonicalCsvCell(row.amountMinor.toString(), numeric = true),
    canonicalCsvCell(row.currency),
    canonicalCsvCell(row.note),
    canonicalCsvCell(row.fingerprint),
    canonicalCsvCell(row.bankReference),
).joinToString(",") + "\n"

fun isFullLedgerSelection(selection: ExportSelection, filters: LedgerExportFilters): Boolean =
    selection == ExportSelection.All

/** Writes canonical rows incrementally; the sequence is never materialized by this helper. */
fun writeCanonicalLedgerCsv(output: OutputStream, rows: Sequence<LedgerExportRow>) {
    output.write(CANONICAL_LEDGER_HEADER.toByteArray(StandardCharsets.UTF_8))
    rows.forEach { row -> output.write(canonicalLedgerCsvRow(row).toByteArray(StandardCharsets.UTF_8)) }
}

private val FormulaLikeSegment = Regex("(^|[,;\\t\\r\\n])(\\s*[=+\\-@])")
