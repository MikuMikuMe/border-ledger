package com.lofuyu.borderledger.imports

import java.nio.charset.StandardCharsets
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

const val IMPORT_PREVIEW_TTL_MILLIS: Long = 24L * 60L * 60L * 1000L
const val IMPORT_PREVIEW_TTL_MS: Long = IMPORT_PREVIEW_TTL_MILLIS

/** Canonical owner-account choice used by the native import entry screen. */
data class ImportAccount(
    val id: String,
    val displayName: String,
    val currencies: List<String> = emptyList(),
)

data class ImportSourceIdentity(
    val bankSourceId: String? = null,
    val bankRowId: String? = null,
)

/** Native spelling of the Worker import row contract. Amounts remain minor units. */
data class OwnerImportRow(
    val rowId: String,
    val rowIndex: Int,
    val accountId: String,
    val date: String,
    val merchant: String,
    val amountMinor: Long,
    val currency: String,
    val category: String,
    val kind: String,
    val status: String,
    val source: String = "statement",
    val fingerprint: String,
    val note: String? = null,
    val bankReference: String? = null,
    val sourceIdentity: ImportSourceIdentity? = null,
)

data class ImportRowError(
    val code: String,
    val message: String,
    val rowId: String? = null,
)

data class ImportDuplicateCandidate(
    val id: String,
    val statementTransactionId: String,
    val candidateTransactionId: String,
    val score: Int,
    val reasonCodes: List<String>,
    val status: String,
)

data class ImportPreview(
    val id: String,
    val revision: Int,
    val expiresAt: String,
    val status: String,
    val accountId: String,
    val fileSha256: String,
    val rowCount: Int,
    val receivedRowCount: Int = 0,
    val validRowCount: Int = 0,
    val errors: List<ImportRowError> = emptyList(),
    val duplicateCandidates: List<ImportDuplicateCandidate> = emptyList(),
    val fileSizeBytes: Long = 0L,
) {
    /** Worker responses call this field `state`; status remains the Kotlin-friendly alias. */
    val state: String get() = status
}

data class CreateImportPreviewRequest(
    val accountId: String,
    val fileName: String,
    val fileSizeBytes: Long,
    val fileSha256: String,
    val format: String = "csv",
    val rowCount: Int,
    val idempotencyKey: String,
)

data class StageImportChunkRequest(
    val previewId: String,
    val chunkIndex: Int,
    val operationId: String,
    val rowStart: Int,
    val rows: List<OwnerImportRow>,
)

data class CommitImportRequest(
    val previewId: String,
    val expectedRevision: Int,
    val rowIds: List<String>,
    val operationId: String,
)

data class DecideImportDuplicateRequest(
    val previewId: String,
    val candidateId: String,
    val expectedRevision: Int,
    val decision: String,
    val idempotencyKey: String,
)

data class CancelImportRequest(
    val previewId: String,
    val expectedRevision: Int,
)

data class ImportCommitResponse(
    val receiptId: String?,
    val importId: String,
    val publishedRows: Int,
    val duplicateRows: Int,
    val needsReview: Int,
    val revision: Int,
    val committedAt: String?,
    val duplicateCandidates: List<ImportDuplicateCandidate> = emptyList(),
)

typealias ImportCommitResult = ImportCommitResponse

/** Non-null receipt used by UI success states. */
data class ImportCommitReceipt(
    val receiptId: String,
    val importId: String,
    val publishedRows: Int,
    val duplicateRows: Int,
    val needsReview: Int,
    val revision: Int,
    val committedAt: String?,
    val duplicateCandidates: List<ImportDuplicateCandidate> = emptyList(),
)

data class ImportFailure(
    val code: String,
    val message: String,
    val retryable: Boolean = false,
)

/** Owner-scoped seam for the existing Worker import service. Capture credentials never implement it. */
interface OwnerImportGateway {
    suspend fun createImportPreview(request: CreateImportPreviewRequest): ImportPreview
    suspend fun stageImportChunk(request: StageImportChunkRequest): ImportPreview
    suspend fun commitImport(request: CommitImportRequest): ImportCommitResponse
    suspend fun decideDuplicate(request: DecideImportDuplicateRequest): ImportPreview
    suspend fun cancelImport(request: CancelImportRequest): ImportPreview
}

typealias OwnerImportApi = OwnerImportGateway

data class ImportDraft(
    val preview: ImportPreview,
    val rows: List<OwnerImportRow>,
    val selectedRowIds: Set<String>,
    val parseErrors: List<String> = emptyList(),
)

@JvmInline
private value class ImportAccountId(val raw: String)

@JvmInline
private value class ImportIdempotencyKey(val raw: String)

@JvmInline
private value class StageOperationId(val raw: String)

private data class DuplicateDecisionInput(
    val candidateId: String,
    val decision: String,
)

sealed interface ImportState {
    data object Idle : ImportState
    data class Previewing(val fileName: String) : ImportState
    data class Staging(val draft: ImportDraft) : ImportState
    data class Ready(val draft: ImportDraft) : ImportState {
        val preview: ImportPreview get() = draft.preview
        val rows: List<OwnerImportRow> get() = draft.rows
        val selectedRowIds: Set<String> get() = draft.selectedRowIds
        val parseErrors: List<String> get() = draft.parseErrors
    }
    data class Committing(val draft: ImportDraft) : ImportState
    data class Cancelling(val draft: ImportDraft) : ImportState
    data class Committed(val receipt: ImportCommitReceipt) : ImportState
    data object Cancelled : ImportState
    data class Error(
        val failure: ImportFailure,
        val draft: ImportDraft? = null,
    ) : ImportState
}

/**
 * Owns the review/selection/commit state for one staged owner import. A commit is
 * successful only after the gateway returns a non-empty Worker receipt ID.
 */
class ImportRepository(
    private val gateway: OwnerImportGateway,
    private val idGenerator: () -> String = { UUID.randomUUID().toString() },
) {
    private val _state = MutableStateFlow<ImportState>(ImportState.Idle)
    val state: StateFlow<ImportState> = _state.asStateFlow()

    private var commitOperationId: String? = null

    /** Drop the in-memory draft when the authenticated owner generation changes. */
    fun reset() {
        commitOperationId = null
        _state.value = ImportState.Idle
    }

    suspend fun preview(
        document: DocumentReadResult,
        accountId: String,
        idempotencyKey: String = idGenerator(),
    ): ImportState = when (document) {
        is DocumentReadResult.Success -> preview(document, accountId, idempotencyKey)
        DocumentReadResult.Canceled -> {
            _state.value = ImportState.Cancelled
            ImportState.Cancelled
        }
        DocumentReadResult.PermissionLost -> fail(
            ImportFailure("permission_lost", "The selected document is no longer readable. Choose it again.", retryable = true),
        )
        DocumentReadResult.TooLarge -> fail(
            ImportFailure("file_too_large", "CSV files are limited to 10 MiB."),
        )
        DocumentReadResult.UnsupportedFormat -> fail(
            ImportFailure("unsupported_format", "Only UTF-8 CSV statements are supported."),
        )
        is DocumentReadResult.Corrupt -> fail(
            ImportFailure("corrupt_document", "The selected CSV could not be read: ${document.reason}."),
        )
        is DocumentReadResult.Unavailable -> fail(
            ImportFailure("document_unavailable", "The selected document could not be read: ${document.reason}.", retryable = true),
        )
    }

    suspend fun preview(
        document: DocumentReadResult.Success,
        accountId: String,
        idempotencyKey: String = idGenerator(),
    ): ImportState {
        val input = PreviewInput(
            document = document,
            accountId = ImportAccountId(accountId),
            idempotencyKey = ImportIdempotencyKey(idempotencyKey),
        )
        validatePreview(input)?.let { return fail(it) }

        val rows = document.rows.map { it.toOwnerRow(input.accountId) }
        _state.value = ImportState.Previewing(document.fileName)
        return try {
            val remotePreview = gateway.createImportPreview(input.createRequest(rows))
            val stagedPreview = stageRows(remotePreview, rows, document.errors, input.stageOperationId)
            readyState(stagedPreview, rows, document.errors)
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            fail(ImportFailure("preview_failed", error.message ?: "The statement preview could not be prepared.", retryable = true))
        }
    }

    fun setRowSelected(rowId: String, selected: Boolean) {
        val current = draftForSelection() ?: return
        if (current.rows.none { it.rowId == rowId }) return
        val next = current.selectedRowIds.toMutableSet().apply {
            if (selected) add(rowId) else remove(rowId)
        }
        _state.value = ImportState.Ready(current.copy(selectedRowIds = next))
    }

    fun selectAllRows() {
        val current = draftForSelection() ?: return
        _state.value = ImportState.Ready(current.copy(selectedRowIds = current.rows.map { it.rowId }.toSet()))
    }

    fun clearSelection() {
        val current = draftForSelection() ?: return
        _state.value = ImportState.Ready(current.copy(selectedRowIds = emptySet()))
    }

    suspend fun decideDuplicate(candidateId: String, decision: String): ImportState {
        val draft = draftForSelection()
            ?: return fail(ImportFailure("no_preview", "Preview the statement before deciding a duplicate."))
        val input = DuplicateDecisionInput(candidateId, decision)
        return when (val plan = duplicateDecisionPlan(draft, input)) {
            is DuplicateDecisionPlan.Rejected -> fail(plan.failure, draft)
            DuplicateDecisionPlan.AlreadyResolved -> ImportState.Ready(draft)
            is DuplicateDecisionPlan.Submit -> submitDuplicateDecision(draft, plan.request)
        }
    }

    private suspend fun submitDuplicateDecision(
        draft: ImportDraft,
        request: DecideImportDuplicateRequest,
    ): ImportState {
        return try {
            val updated = gateway.decideDuplicate(request)
            val next = ImportState.Ready(draft.copy(preview = updated))
            _state.value = next
            next
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            fail(ImportFailure("duplicate_decision_failed", error.message ?: "The duplicate decision was not saved.", retryable = true), draft)
        }
    }

    suspend fun commit(operationId: String? = null): ImportCommitReceipt? {
        val draft = draftForCommit() ?: return null
        val stableOperationId = operationId ?: commitOperationId ?: "commit-${draft.preview.id}-${idGenerator()}"
        commitOperationId = stableOperationId
        _state.value = ImportState.Committing(draft)
        return try {
            val response = gateway.commitImport(
                CommitImportRequest(
                    previewId = draft.preview.id,
                    expectedRevision = draft.preview.revision,
                    rowIds = draft.selectedRowIds.toList().sorted(),
                    operationId = stableOperationId,
                ),
            )
            finalizeCommit(response, draft)
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            fail(ImportFailure("commit_failed", error.message ?: "The import was not committed.", retryable = true), draft)
            null
        }
    }

    suspend fun cancel(): ImportState {
        val draft = draftForSelection()
        if (draft == null) {
            return fail(ImportFailure("no_preview", "Preview the statement before cancelling it."))
        }
        _state.value = ImportState.Cancelling(draft)
        return try {
            val response = gateway.cancelImport(CancelImportRequest(draft.preview.id, draft.preview.revision))
            if (response.status.lowercase() !in setOf("cancelled", "canceled")) {
                fail(ImportFailure("cancel_not_confirmed", "The Worker did not confirm cancellation; the staged preview remains available."), draft)
            } else {
                _state.value = ImportState.Cancelled
                ImportState.Cancelled
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            fail(ImportFailure("cancel_failed", error.message ?: "The staged import could not be cancelled.", retryable = true), draft)
        }
    }

    suspend fun retryCommit(): ImportCommitReceipt? = commit(commitOperationId)

    private fun draftForCommit(): ImportDraft? {
        val draft = draftForSelection()
        if (draft == null) {
            fail(ImportFailure("no_preview", "Preview the statement before committing it."))
            return null
        }
        if (draft.selectedRowIds.isEmpty()) {
            fail(ImportFailure("invalid_selection", "Select at least one row to commit."), draft)
            return null
        }
        if (draft.selectedRowIds.size > MAX_COMMIT_ROWS) {
            fail(ImportFailure("invalid_selection", "Select no more than $MAX_COMMIT_ROWS rows to commit."), draft)
            return null
        }
        return draft
    }

    private fun finalizeCommit(response: ImportCommitResponse, draft: ImportDraft): ImportCommitReceipt? {
        val receiptId = response.receiptId?.takeIf { it.isNotBlank() }
        if (receiptId == null) {
            fail(
                ImportFailure(
                    "missing_worker_receipt",
                    "The Worker did not return a commit receipt; the import is not reported as committed.",
                    retryable = true,
                ),
                draft,
            )
            return null
        }
        val receipt = ImportCommitReceipt(
            receiptId = receiptId,
            importId = response.importId,
            publishedRows = response.publishedRows,
            duplicateRows = response.duplicateRows,
            needsReview = response.needsReview,
            revision = response.revision,
            committedAt = response.committedAt,
            duplicateCandidates = response.duplicateCandidates,
        )
        _state.value = ImportState.Committed(receipt)
        return receipt
    }

    private fun validatePreview(input: PreviewInput): ImportFailure? = when {
        input.accountId.raw.isBlank() -> ImportFailure("invalid_account", "Choose an owner account before previewing the statement.")
        input.document.fileSizeBytes <= 0L || input.document.fileSizeBytes > MAX_IMPORT_FILE_BYTES ->
            ImportFailure("file_too_large", "CSV files are limited to 10 MiB.")
        input.document.rows.isEmpty() -> ImportFailure("no_valid_rows", "No valid statement rows are available to preview.")
        input.document.rows.size > MAX_IMPORT_ROWS -> ImportFailure("too_many_rows", "Imports are limited to $MAX_IMPORT_ROWS rows.")
        else -> null
    }

    private suspend fun stageRows(
        initialPreview: ImportPreview,
        rows: List<OwnerImportRow>,
        parseErrors: List<String>,
        operationId: StageOperationId,
    ): ImportPreview {
        var remotePreview = initialPreview
        var rowStart = 0
        ImportChunker.chunk(rows).forEachIndexed { index, chunk ->
            _state.value = ImportState.Staging(
                ImportDraft(remotePreview, rows, rows.map { it.rowId }.toSet(), parseErrors),
            )
            remotePreview = gateway.stageImportChunk(
                StageImportChunkRequest(
                    previewId = remotePreview.id,
                    chunkIndex = index,
                    operationId = operationId.raw,
                    rowStart = rowStart,
                    rows = chunk,
                ),
            )
            rowStart += chunk.size
        }
        return remotePreview
    }

    private fun readyState(
        preview: ImportPreview,
        rows: List<OwnerImportRow>,
        parseErrors: List<String>,
    ): ImportState.Ready {
        val draft = ImportDraft(preview, rows, rows.map { it.rowId }.toSet(), parseErrors)
        return ImportState.Ready(draft).also { _state.value = it }
    }

    private fun duplicateDecisionPlan(
        draft: ImportDraft,
        input: DuplicateDecisionInput,
    ): DuplicateDecisionPlan {
        val duplicateDecision = input.toDuplicateDecision()
            ?: return DuplicateDecisionPlan.Rejected(
                ImportFailure("invalid_decision", "The duplicate decision is not supported."),
            )
        val candidate = draft.preview.duplicateCandidates.firstOrNull { it.id == input.candidateId }
            ?: return DuplicateDecisionPlan.Rejected(
                ImportFailure("candidate_not_found", "The duplicate candidate is no longer in this preview."),
            )
        if (candidate.status != "open") return DuplicateDecisionPlan.AlreadyResolved
        return DuplicateDecisionPlan.Submit(
            DecideImportDuplicateRequest(
                previewId = draft.preview.id,
                candidateId = input.candidateId,
                expectedRevision = draft.preview.revision,
                decision = duplicateDecision.wireValue,
                idempotencyKey = "duplicate-${draft.preview.id}-${input.candidateId}-${duplicateDecision.wireValue}",
            ),
        )
    }

    private data class PreviewInput(
        val document: DocumentReadResult.Success,
        val accountId: ImportAccountId,
        val idempotencyKey: ImportIdempotencyKey,
    ) {
        fun createRequest(rows: List<OwnerImportRow>): CreateImportPreviewRequest = CreateImportPreviewRequest(
            accountId = accountId.raw,
            fileName = document.fileName,
            fileSizeBytes = document.fileSizeBytes,
            fileSha256 = document.fileSha256,
            rowCount = rows.size,
            idempotencyKey = idempotencyKey.raw,
        )

        val stageOperationId: StageOperationId get() = StageOperationId("stage-${idempotencyKey.raw}")
    }

    private sealed interface DuplicateDecisionPlan {
        data object AlreadyResolved : DuplicateDecisionPlan
        data class Rejected(val failure: ImportFailure) : DuplicateDecisionPlan
        data class Submit(val request: DecideImportDuplicateRequest) : DuplicateDecisionPlan
    }

    private enum class DuplicateDecision(val wireValue: String) {
        RESOLVE("resolve"),
        KEEP_SEPARATE("keep_separate"),
        ;

    }

    private fun DuplicateDecisionInput.toDuplicateDecision(): DuplicateDecision? =
        DuplicateDecision.entries.firstOrNull { it.wireValue == decision }

    private fun draftForSelection(): ImportDraft? = when (val current = _state.value) {
        is ImportState.Ready -> current.draft
        is ImportState.Error -> current.draft
        is ImportState.Committing -> current.draft
        is ImportState.Cancelling -> current.draft
        else -> null
    }

    private fun fail(failure: ImportFailure, draft: ImportDraft? = null): ImportState.Error {
        val next = ImportState.Error(failure, draft)
        _state.value = next
        return next
    }

    private fun StatementRow.toOwnerRow(accountId: ImportAccountId): OwnerImportRow = OwnerImportRow(
        rowId = rowId,
        rowIndex = rowIndex,
        accountId = accountId.raw,
        date = date,
        merchant = merchant,
        amountMinor = amountMinor,
        currency = currency,
        category = category,
        kind = kind,
        status = status,
        source = source,
        fingerprint = fingerprint,
        note = note,
        bankReference = bankReference,
    )

    companion object {
        const val MAX_IMPORT_ROWS = 10_000
        const val MAX_COMMIT_ROWS = 500
    }
}

/** Deterministic Worker-compatible row chunking, bounded by both rows and UTF-8 bytes. */
object ImportChunker {
    /** Native safety ceiling: 64 KiB, deliberately below the Worker's 128 KiB body limit. */
    const val MAX_CHUNK_BYTES = 64 * 1024
    const val MAX_CHUNK_ROWS = 1_000

    fun chunk(
        rows: List<OwnerImportRow>,
        maxBytes: Int = MAX_CHUNK_BYTES,
        maxRows: Int = MAX_CHUNK_ROWS,
    ): List<List<OwnerImportRow>> {
        val limits = ChunkLimits(ChunkByteLimit(maxBytes), ChunkRowLimit(maxRows))
        val accumulator = ChunkAccumulator(limits)
        rows.mapIndexed { index, row -> EncodedChunkRow(index, row, encodeRow(row)) }.forEach { entry ->
            accumulator.add(entry)
        }
        return accumulator.finish()
    }

    @JvmInline
    private value class ChunkByteLimit(val value: Int)

    @JvmInline
    private value class ChunkRowLimit(val value: Int)

    private data class ChunkLimits(
        val maxBytes: ChunkByteLimit,
        val maxRows: ChunkRowLimit,
    ) {
        init {
            require(maxBytes.value > JSON_ARRAY_OVERHEAD_BYTES) { "The chunk byte limit is too small." }
            require(maxRows.value > 0) { "The chunk row limit must be positive." }
        }
    }

    private data class EncodedChunkRow(
        val index: Int,
        val row: OwnerImportRow,
        val json: String,
    )

    private class ChunkAccumulator(private val limits: ChunkLimits) {
        private val chunks = mutableListOf<List<OwnerImportRow>>()
        private var currentRows = mutableListOf<OwnerImportRow>()
        private var currentBytes = JSON_ARRAY_OVERHEAD_BYTES

        fun add(entry: EncodedChunkRow) {
            val rowBytes = entry.json.toByteArray(StandardCharsets.UTF_8).size
            require(rowBytes + JSON_ARRAY_OVERHEAD_BYTES <= limits.maxBytes.value) {
                "Import row ${entry.index + 1} exceeds the chunk byte limit."
            }
            if (requiresFlush(entry)) flush()
            currentRows += entry.row
            currentBytes += rowBytes + if (currentRows.size == 1) 0 else JSON_SEPARATOR_BYTES
        }

        fun finish(): List<List<OwnerImportRow>> {
            if (currentRows.isNotEmpty()) flush()
            return chunks
        }

        private fun requiresFlush(entry: EncodedChunkRow): Boolean = currentRows.isNotEmpty() && (
            currentRows.size >= limits.maxRows.value ||
                currentBytes + entry.json.toByteArray(StandardCharsets.UTF_8).size + JSON_SEPARATOR_BYTES > limits.maxBytes.value
            )

        private fun flush() {
            chunks += currentRows
            currentRows = mutableListOf()
            currentBytes = JSON_ARRAY_OVERHEAD_BYTES
        }
    }

    private fun encodeRow(row: OwnerImportRow): String = buildString {
        append('{')
        field(JsonField("rowId", row.rowId))
        field(JsonField("rowIndex", row.rowIndex))
        field(JsonField("accountId", row.accountId))
        field(JsonField("date", row.date))
        field(JsonField("merchant", row.merchant))
        field(JsonField("amountMinor", row.amountMinor))
        field(JsonField("currency", row.currency))
        field(JsonField("category", row.category))
        field(JsonField("kind", row.kind))
        field(JsonField("status", row.status))
        field(JsonField("source", row.source))
        field(JsonField("fingerprint", row.fingerprint))
        field(JsonField("note", row.note))
        field(JsonField("bankReference", row.bankReference))
        row.sourceIdentity?.let {
            field(JsonField(
                "sourceIdentity",
                "{\"bankSourceId\":${jsonString(JsonText(it.bankSourceId))},\"bankRowId\":${jsonString(JsonText(it.bankRowId))}}",
                raw = true,
            ))
        }
        if (last() == ',') setLength(length - 1)
        append('}')
    }

    private data class JsonField(
        val name: String,
        val value: Any?,
        val raw: Boolean = false,
    )

    private fun StringBuilder.field(field: JsonField) {
        append(jsonString(JsonText(field.name))).append(':')
        append(if (field.raw) field.value.toString() else jsonValue(field.value))
        append(',')
    }

    private fun jsonValue(value: Any?): String = when (value) {
        null -> "null"
        is Number -> value.toString()
        else -> jsonString(JsonText(value.toString()))
    }

    private data class JsonText(val value: String?)

    private fun jsonString(value: JsonText): String = value.value?.let {
        buildString {
            append('"')
            it.forEach { character ->
                when (character) {
                    '\\' -> append("\\\\")
                    '"' -> append("\\\"")
                    '\b' -> append("\\b")
                    '\u000C' -> append("\\f")
                    '\n' -> append("\\n")
                    '\r' -> append("\\r")
                    '\t' -> append("\\t")
                    else -> if (character.code < 0x20) append("\\u%04x".format(character.code)) else append(character)
                }
            }
            append('"')
        }
    } ?: "null"

    private const val JSON_ARRAY_OVERHEAD_BYTES = 2
    private const val JSON_SEPARATOR_BYTES = 1
}
