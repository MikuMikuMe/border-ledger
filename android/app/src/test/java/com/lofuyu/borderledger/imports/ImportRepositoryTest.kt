package com.lofuyu.borderledger.imports

import java.io.ByteArrayInputStream
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

private const val WORKER_MAX_CHUNK_BYTES = 128 * 1024

class ImportRepositoryTest {
    @Test
    fun previewStagesRowsAndSelectsOnlyRowsWithAWorkerPreview() = runTest {
        val gateway = RecordingImportGateway()
        val repository = ImportRepository(gateway)

        repository.preview(
            document = validDocument(),
            accountId = "account-1",
            idempotencyKey = "preview-1",
        )

        val state = repository.state.value as ImportState.Ready
        assertEquals(setOf("row-1", "row-2"), state.selectedRowIds)
        assertEquals(1, gateway.previewRequests.size)
        assertEquals(1, gateway.chunkRequests.size)
        assertEquals("account-1", gateway.previewRequests.single().accountId)
    }

    @Test
    fun previewCarriesWorkerDuplicateCandidatesBeforeCommit() = runTest {
        val candidate = ImportDuplicateCandidate(
            id = "candidate-1",
            statementTransactionId = "row-1",
            candidateTransactionId = "existing-1",
            score = 95,
            reasonCodes = listOf("same_account", "same_amount", "merchant_match"),
            status = "open",
        )
        val gateway = RecordingImportGateway(previewCandidates = listOf(candidate))
        val repository = ImportRepository(gateway)

        repository.preview(validDocument(), "account-1", "preview-candidate")

        val state = repository.state.value as ImportState.Ready
        assertEquals(listOf(candidate), state.preview.duplicateCandidates)
        assertTrue(gateway.commitRequests.isEmpty())
    }

    @Test
    fun commitWithoutWorkerReceiptIsAnErrorAndNeverCommitted() = runTest {
        val gateway = RecordingImportGateway(commitResponse = ImportCommitResponse(
            receiptId = null,
            importId = "import-1",
            publishedRows = 2,
            duplicateRows = 0,
            needsReview = 0,
            revision = 2,
            committedAt = "2026-10-14T12:00:00Z",
        ))
        val repository = ImportRepository(gateway)
        repository.preview(validDocument(), "account-1", "preview-2")

        repository.commit(operationId = "operation-1")

        val state = repository.state.value as ImportState.Error
        assertEquals("missing_worker_receipt", state.failure.code)
        assertTrue(gateway.commitRequests.single().rowIds.contains("row-1"))
    }

    @Test
    fun commitWithWorkerReceiptIsTheOnlyCommittedState() = runTest {
        val gateway = RecordingImportGateway(commitResponse = ImportCommitResponse(
            receiptId = "receipt-1",
            importId = "import-1",
            publishedRows = 1,
            duplicateRows = 1,
            needsReview = 0,
            revision = 2,
            committedAt = "2026-10-14T12:00:00Z",
        ))
        val repository = ImportRepository(gateway)
        repository.preview(validDocument(), "account-1", "preview-3")
        repository.setRowSelected("row-2", false)

        repository.commit(operationId = "operation-2")

        val state = repository.state.value as ImportState.Committed
        assertEquals("receipt-1", state.receipt.receiptId)
        assertEquals(1, state.receipt.publishedRows)
    }

    @Test
    fun cancelReportsCancellationAndDoesNotInventACommitReceipt() = runTest {
        val gateway = RecordingImportGateway()
        val repository = ImportRepository(gateway)
        repository.preview(validDocument(), "account-1", "preview-4")

        repository.cancel()

        assertEquals(ImportState.Cancelled, repository.state.value)
        assertEquals("preview-1", gateway.cancelRequests.single().previewId)
    }

    @Test
    fun cancelRequiresTheWorkerToConfirmCancellation() = runTest {
        val gateway = RecordingImportGateway(cancelStatus = "ready")
        val repository = ImportRepository(gateway)
        repository.preview(validDocument(), "account-1", "preview-5")

        repository.cancel()

        val state = repository.state.value as ImportState.Error
        assertEquals("cancel_not_confirmed", state.failure.code)
    }

    @Test
    fun cancelWithoutAStagedPreviewDoesNotClaimWorkerCancellation() = runTest {
        val repository = ImportRepository(RecordingImportGateway())

        val result = repository.cancel()

        val state = result as ImportState.Error
        assertEquals("no_preview", state.failure.code)
        assertTrue(repository.state.value !is ImportState.Cancelled)
    }

    @Test
    fun readerFailureBecomesAnExplicitRepositoryError() = runTest {
        val repository = ImportRepository(RecordingImportGateway())

        val result = repository.preview(DocumentReadResult.PermissionLost, "account-1", "preview-permission")

        val state = result as ImportState.Error
        assertEquals("permission_lost", state.failure.code)
        assertTrue(repository.state.value !is ImportState.Ready)
    }

    @Test
    fun resetDropsThePriorOwnersDraftAndStableCommitIdentity() = runTest {
        val gateway = RecordingImportGateway()
        val repository = ImportRepository(gateway)
        repository.preview(validDocument(), "account-a", "preview-owner-a")
        repository.commit(operationId = "commit-owner-a")

        repository.reset()

        assertEquals(ImportState.Idle, repository.state.value)
        assertTrue(repository.retryCommit() == null)
        assertEquals(1, gateway.commitRequests.size)
    }

    @Test
    fun chunkLimitMatchesTheWorkerBodyLimit() {
        assertEquals(64 * 1024, ImportChunker.MAX_CHUNK_BYTES)
        assertTrue(ImportChunker.MAX_CHUNK_BYTES < WORKER_MAX_CHUNK_BYTES)
    }

    private fun validDocument(): DocumentReadResult.Success = StatementDocumentReader(
        ImportFakeSource(
            "statement.csv",
            "Date,Description,Amount,Currency\n2026-10-13,Cafe,-1.00,CAD\n2026-10-14,Market,-2.00,CAD".toByteArray(),
        ),
    ).read(android.net.Uri.parse("content://test/import")) as DocumentReadResult.Success
}

private class RecordingImportGateway(
    private val commitResponse: ImportCommitResponse = ImportCommitResponse(
        receiptId = "receipt-default",
        importId = "import-default",
        publishedRows = 2,
        duplicateRows = 0,
        needsReview = 0,
        revision = 2,
        committedAt = "2026-10-14T12:00:00Z",
    ),
    private val cancelStatus: String = "cancelled",
    private val previewCandidates: List<ImportDuplicateCandidate> = emptyList(),
) : OwnerImportGateway {
    val previewRequests = mutableListOf<CreateImportPreviewRequest>()
    val chunkRequests = mutableListOf<StageImportChunkRequest>()
    val commitRequests = mutableListOf<CommitImportRequest>()
    val duplicateDecisionRequests = mutableListOf<DecideImportDuplicateRequest>()
    val cancelRequests = mutableListOf<CancelImportRequest>()

    override suspend fun createImportPreview(request: CreateImportPreviewRequest): ImportPreview {
        previewRequests += request
        return preview(request.rowCount)
    }

    override suspend fun stageImportChunk(request: StageImportChunkRequest): ImportPreview {
        chunkRequests += request
        return preview(request.rows.size)
    }

    override suspend fun commitImport(request: CommitImportRequest): ImportCommitResponse {
        commitRequests += request
        return commitResponse
    }

    override suspend fun decideDuplicate(request: DecideImportDuplicateRequest): ImportPreview {
        duplicateDecisionRequests += request
        val next = previewCandidates.map { candidate ->
            if (candidate.id != request.candidateId) candidate
            else candidate.copy(status = if (request.decision == "resolve") "accepted" else "dismissed")
        }
        return preview(2, previewCandidates = next)
    }

    override suspend fun cancelImport(request: CancelImportRequest): ImportPreview {
        cancelRequests += request
        return preview(2, status = cancelStatus)
    }

    private fun preview(rowCount: Int, status: String = "ready", previewCandidates: List<ImportDuplicateCandidate> = this.previewCandidates) = ImportPreview(
        id = "preview-1",
        revision = 1,
        expiresAt = "2026-10-15T12:00:00Z",
        status = status,
        accountId = "account-1",
        fileSha256 = "a".repeat(64),
        rowCount = rowCount,
        receivedRowCount = rowCount,
        validRowCount = rowCount,
        duplicateCandidates = previewCandidates,
    )
}

private class ImportFakeSource(
    private val name: String,
    private val bytes: ByteArray,
) : StatementDocumentSource {
    override fun displayName(uri: android.net.Uri): String = name
    override fun mimeType(uri: android.net.Uri): String? = "text/csv"
    override fun length(uri: android.net.Uri): Long = bytes.size.toLong()
    override fun persistReadPermission(uri: android.net.Uri) = Unit
    override fun open(uri: android.net.Uri) = ByteArrayInputStream(bytes)
}
