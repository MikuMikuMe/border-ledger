package com.lofuyu.borderledger.review

import com.lofuyu.borderledger.api.TransportFailure
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.Locale

const val SNAPSHOT_REVIEW_ACTION_DISABLED_REASON =
    "Actions disabled: the cached owner snapshot has no alert event ID and revision; refresh the owner Review API before deciding."

const val SNAPSHOT_ANNOTATION_DISABLED_REASON =
    "Annotation disabled: the cached owner snapshot has no transaction revision; refresh an owner transaction model before editing."

const val LIVE_ANNOTATION_DISABLED_REASON =
    "Annotation disabled: the bounded alert response has no transaction ID or transaction revision; load an owner transaction model before editing."

const val ANNOTATION_UNSUPPORTED_REASON =
    "Category/note disabled: this Review row is not backed by a personal transaction annotation target."

const val CLASSIFICATION_UNSUPPORTED_REASON =
    "Lifecycle classify disabled: use the owner-scoped category and note action below when this row has a personal transaction target."

const val LINK_ACTION_UNAVAILABLE_REASON =
    "Link disabled: no valid candidate, target transaction, and supported relation are available."

const val LINK_RELATION_UNSUPPORTED_REASON =
    "Link disabled: the candidate relation is not supported by the current reconciliation store."

data class ReviewViewState(
    val loading: Boolean = true,
    val items: List<ReviewAlertDto> = emptyList(),
    val nextCursor: String? = null,
    val error: String? = null,
    val actionError: String? = null,
    val actionMessage: String? = null,
    val pendingActionKey: String? = null,
    val hasAuthoritativeData: Boolean = false,
)

class ReviewViewModel(
    private val repository: ReviewRepository,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
) {
    private val _state = MutableStateFlow(ReviewViewState())
    val state: StateFlow<ReviewViewState> = _state.asStateFlow()

    fun refresh() {
        scope.launch { refreshPage() }
    }

    fun loadMore() {
        val current = _state.value
        val cursor = current.nextCursor ?: return
        if (current.loading) return
        _state.value = current.copy(loading = true, error = null, actionError = null)
        scope.launch {
            runCatching { repository.readAlerts(ReviewQuery(cursor = cursor)) }
                .onSuccess { page ->
                    _state.value = _state.value.copy(
                        loading = false,
                        items = _state.value.items + page.items,
                        nextCursor = page.nextCursor,
                        hasAuthoritativeData = true,
                    )
                }
                .onFailure { error ->
                    _state.value = _state.value.copy(
                        loading = false,
                        error = readErrorMessage(error),
                    )
                }
        }
    }

    fun resolve(alert: ReviewAlertDto, decision: ReviewDecision) {
        val current = _state.value.items.singleOrNull { it.eventId == alert.eventId }
        if (current == null) {
            _state.value = _state.value.copy(
                actionError = "This review is no longer loaded; refresh before saving.",
                actionMessage = null,
            )
            return
        }
        if (current.revision != alert.revision) {
            _state.value = _state.value.copy(
                actionError = "This review changed locally; refresh before saving.",
                actionMessage = null,
            )
            return
        }
        current.actionDisabledReason(decision)?.let { reason ->
            _state.value = _state.value.copy(actionError = reason, actionMessage = null)
            return
        }
        if (_state.value.pendingActionKey != null) return

        val actionKey = "alert:${current.eventId}"
        _state.value = _state.value.copy(
            pendingActionKey = actionKey,
            actionError = null,
            actionMessage = null,
        )
        scope.launch {
            try {
                val linkAction = if (decision == ReviewDecision.LINK) current.linkAction else null
                val acknowledgement = repository.reviewAlert(
                    eventId = current.eventId,
                    expectedRevision = current.revision,
                    decision = decision,
                    targetId = linkAction?.targetId,
                    candidateTransactionId = linkAction?.candidateTransactionId,
                    relation = linkAction?.relation,
                    allocatedMoney = linkAction?.allocatedMoney,
                )
                refreshPage(successMessage = "Review decision accepted at revision ${acknowledgement.revision}.")
            } catch (error: ReviewRevisionConflict) {
                refreshPage(actionError = conflictMessage(error))
            } catch (error: Throwable) {
                _state.value = _state.value.copy(
                    pendingActionKey = null,
                    actionError = actionErrorMessage(error),
                    actionMessage = null,
                )
            }
        }
    }

    fun saveAnnotation(alert: ReviewAlertDto, category: String, note: String?) {
        val current = _state.value.items.singleOrNull { it.eventId == alert.eventId }
        if (current == null) {
            _state.value = _state.value.copy(actionError = "This review is no longer loaded; refresh before saving.", actionMessage = null)
            return
        }
        if (current.revision != alert.revision) {
            _state.value = _state.value.copy(actionError = "This review changed locally; refresh before saving.", actionMessage = null)
            return
        }
        val annotation = current.annotation
        if (annotation == null) {
            _state.value = _state.value.copy(
                actionError = current.annotationDisabledReason ?: ANNOTATION_UNSUPPORTED_REASON,
                actionMessage = null,
            )
            return
        }
        if (category.isBlank() || category.length > ReviewLimits.MAX_CATEGORY_LENGTH || note?.length ?: 0 > ReviewLimits.MAX_NOTE_LENGTH) {
            _state.value = _state.value.copy(
                actionError = "Category and note must stay within the owner Review limits.",
                actionMessage = null,
            )
            return
        }
        if (_state.value.pendingActionKey != null) return
        _state.value = _state.value.copy(
            pendingActionKey = "annotation:${current.eventId}",
            actionError = null,
            actionMessage = null,
        )
        scope.launch {
            try {
                val acknowledgement = repository.annotateTransaction(annotation.transactionId, annotation.expectedRevision, category, note)
                refreshPage(successMessage = "Category and note accepted at revision ${acknowledgement.revision}.")
            } catch (error: ReviewRevisionConflict) {
                refreshPage(
                    actionError = error.currentRevision?.let {
                        "The category and note changed elsewhere at revision $it; your action was not applied. The authoritative list was refreshed."
                    } ?: "The category and note changed elsewhere; your action was not applied. The authoritative list was refreshed.",
                )
            } catch (error: Throwable) {
                _state.value = _state.value.copy(
                    pendingActionKey = null,
                    actionError = actionErrorMessage(error),
                    actionMessage = null,
                )
            }
        }
    }

    fun saveAnnotation(transactionId: String, expectedRevision: Int, category: String, note: String?) {
        if (transactionId.isBlank() || expectedRevision < 0 || category.isBlank()) {
            _state.value = _state.value.copy(
                actionError = "Annotation requires a transaction ID, category, and non-negative revision.",
                actionMessage = null,
            )
            return
        }
        if (_state.value.pendingActionKey != null) return
        _state.value = _state.value.copy(
            pendingActionKey = "transaction:$transactionId",
            actionError = null,
            actionMessage = null,
        )
        scope.launch {
            try {
                val acknowledgement = repository.annotateTransaction(transactionId, expectedRevision, category, note)
                refreshPage(successMessage = "Annotation accepted at revision ${acknowledgement.revision}.")
            } catch (error: ReviewRevisionConflict) {
                refreshPage(
                    actionError = error.currentRevision?.let {
                        "The transaction annotation changed elsewhere at revision $it; your action was not applied. The authoritative list was refreshed."
                    } ?: "The transaction annotation changed elsewhere; your action was not applied. The authoritative list was refreshed.",
                )
            } catch (error: Throwable) {
                _state.value = _state.value.copy(
                    pendingActionKey = null,
                    actionError = actionErrorMessage(error),
                    actionMessage = null,
                )
            }
        }
    }

    private suspend fun refreshPage(
        successMessage: String? = null,
        actionError: String? = null,
    ) {
        _state.value = _state.value.copy(
            loading = true,
            error = null,
            pendingActionKey = null,
            actionError = actionError,
            actionMessage = successMessage,
        )
        runCatching { repository.readAlerts() }
            .onSuccess { page ->
                _state.value = ReviewViewState(
                    loading = false,
                    items = page.items,
                    nextCursor = page.nextCursor,
                    actionError = actionError,
                    actionMessage = successMessage,
                    hasAuthoritativeData = true,
                )
            }
            .onFailure { error ->
                _state.value = _state.value.copy(
                    loading = false,
                    error = readErrorMessage(error),
                    actionError = actionError,
                    actionMessage = successMessage,
                )
            }
    }

    private fun conflictMessage(error: ReviewRevisionConflict): String = error.currentRevision?.let {
        "This review changed elsewhere at revision $it; your action was not applied. The authoritative list was refreshed."
    } ?: "This review changed elsewhere; your action was not applied. The authoritative list was refreshed."

    private fun readErrorMessage(error: Throwable): String = when (error) {
        TransportFailure.Offline -> "Owner Review data is unavailable offline."
        TransportFailure.Unauthorized -> "Owner authorization is required to read Review."
        is ReviewRouteUnavailable -> "Owner Review API unavailable: ${error.route} returned HTTP ${error.statusCode}."
        is ReviewResponseInvalid -> "The owner Review response could not be verified safely."
        is ReviewRequestFailed -> error.message ?: "The owner Review request failed."
        else -> error.message ?: "Owner Review data is unavailable."
    }

    private fun actionErrorMessage(error: Throwable): String = when (error) {
        TransportFailure.Offline -> "Review actions are unavailable offline; no change was applied."
        TransportFailure.Unauthorized -> "Owner authorization is required for Review; no change was applied."
        is ReviewRouteUnavailable -> "Review API unavailable: ${error.route} returned HTTP ${error.statusCode}; no change was applied."
        is ReviewResponseInvalid -> "The Review response could not be verified; no change was applied."
        is ReviewRequestFailed -> "${error.message ?: "The Review request failed."} No change was applied."
        else -> "Review action failed; no change was applied."
    }
}

fun ReviewAlertDto.actionDisabledReason(decision: ReviewDecision): String? {
    return when (decision) {
        ReviewDecision.KEEP_SEPARATE, ReviewDecision.IGNORE -> if (state.lowercase(Locale.ROOT) == "needs_review") {
            null
        } else {
            "Action disabled: this alert is already in state $state; only needs_review alerts can be resolved."
        }
        ReviewDecision.LINK -> if (state.lowercase(Locale.ROOT) !in setOf("needs_review", "provisional")) {
            "Link disabled: this alert is already in state $state; only provisional or needs_review alerts can be linked."
        } else if (linkAction == null || linkAction.targetId.isBlank() || linkAction.candidateTransactionId.isBlank()) {
            linkDisabledReason ?: LINK_ACTION_UNAVAILABLE_REASON
        } else if (linkAction.relation !in setOf(ReviewRelation.CONFIRMS, ReviewRelation.REFUND_OF)) {
            LINK_RELATION_UNSUPPORTED_REASON
        } else {
            null
        }
        ReviewDecision.CLASSIFY -> CLASSIFICATION_UNSUPPORTED_REASON
    }
}

fun ReviewAlertDto.annotationActionDisabledReason(): String? {
    return annotationDisabledReason ?: if (annotation == null) ANNOTATION_UNSUPPORTED_REASON else null
}
