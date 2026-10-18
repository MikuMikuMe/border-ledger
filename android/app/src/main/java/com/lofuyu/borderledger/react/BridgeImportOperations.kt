package com.lofuyu.borderledger.react

import com.lofuyu.borderledger.imports.*

internal object BridgeImportOperations {
    fun requireDraft(draft: ImportDraft?) { if(draft==null) throw BridgeLocalFailure() }
    fun requireCommit(draft: ImportDraft?) {
        requireDraft(draft)
        if(requireNotNull(draft).selectedRowIds.size !in 1..ImportRepository.MAX_COMMIT_ROWS) throw BridgeLocalFailure()
    }
    fun requireDuplicate(draft: ImportDraft?, candidateId: String, decision: String) {
        requireDraft(draft)
        if(decision !in setOf("resolve","keep_separate") || requireNotNull(draft).preview.duplicateCandidates.none { it.id==candidateId }) throw BridgeLocalFailure()
    }
    fun canReplaceUndrainedPicker(kind: String, status: String?) = kind=="import_picker" && status=="failed_local"

    suspend fun preview(repository: ImportRepository, document: DocumentReadResult, accountId: String, operationId: String): String {
        val result=repository.preview(document,accountId,operationId)
        // These native repository results are produced only before create/stage.
        // preview_failed may follow an accepted backend request and stays unknown.
        if(result is ImportState.Cancelled || result is ImportState.Error && result.failure.code in setOf(
                "permission_lost","file_too_large","unsupported_format","corrupt_document",
                "document_unavailable","invalid_account","no_valid_rows","too_many_rows")) throw BridgeLocalFailure()
        check(result is ImportState.Ready)
        return result.preview.id
    }
}
