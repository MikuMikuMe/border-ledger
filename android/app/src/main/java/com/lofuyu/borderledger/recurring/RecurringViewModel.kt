package com.lofuyu.borderledger.recurring

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class RecurringFilters(val currency: String? = null, val classification: String? = null)

data class RecurringViewState(
    val loading: Boolean = true,
    val items: List<RecurringStreamDto> = emptyList(),
    val summary: RecurringSummaryDto? = null,
    val state: String = "waiting",
    val nextCursor: String? = null,
    val filters: RecurringFilters = RecurringFilters(),
    val error: String? = null,
    val loadMoreError: String? = null,
    val saveError: String? = null,
    val savingId: String? = null,
)

class RecurringViewModel(
    private val repository: RecurringRepository,
    private val summaryQuery: RecurringSummaryQuery,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
) {
    private val _state = MutableStateFlow(RecurringViewState())
    val state: StateFlow<RecurringViewState> = _state.asStateFlow()

    fun load(filters: RecurringFilters = _state.value.filters) {
        _state.value = _state.value.copy(loading = true, filters = filters, error = null, loadMoreError = null)
        scope.launch {
            runCatching {
                val page = async { repository.readPage(RecurringQuery(currency = filters.currency, classification = filters.classification)) }
                val summary = async { repository.readSummary(summaryQuery) }
                page.await() to summary.await()
            }.onSuccess { (page, summary) ->
                _state.value = RecurringViewState(
                    loading = false,
                    items = page.items,
                    summary = summary,
                    state = page.state,
                    nextCursor = page.page.nextCursor,
                    filters = filters,
                )
            }.onFailure { error ->
                _state.value = _state.value.copy(loading = false, error = error.message ?: "Recurring data is unavailable.")
            }
        }
    }

    fun loadMore() {
        val current = _state.value
        val cursor = current.nextCursor ?: return
        if (current.loading) return
        _state.value = current.copy(loading = true, loadMoreError = null)
        scope.launch {
            runCatching {
                repository.readPage(RecurringQuery(cursor = cursor, currency = current.filters.currency, classification = current.filters.classification))
            }.onSuccess { page ->
                _state.value = _state.value.copy(
                    loading = false,
                    items = _state.value.items + page.items,
                    state = page.state,
                    nextCursor = page.page.nextCursor,
                )
            }.onFailure { error ->
                _state.value = _state.value.copy(loading = false, loadMoreError = error.message ?: "More recurring streams could not be loaded.")
            }
        }
    }

    fun saveClassification(id: String, expectedRevision: Int, classification: String) {
        _state.value = _state.value.copy(savingId = id, saveError = null)
        scope.launch {
            runCatching { repository.classify(id, expectedRevision, classification) }
                .onSuccess { load(_state.value.filters) }
                .onFailure { error -> _state.value = _state.value.copy(savingId = null, saveError = error.message ?: "Classification could not be saved.") }
        }
    }
}

class RecurringDetailViewModel(
    private val repository: RecurringRepository,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
) {
    private val _state = MutableStateFlow<RecurringDetailState>(RecurringDetailState.Loading)
    val state: StateFlow<RecurringDetailState> = _state.asStateFlow()

    fun load(id: String, cursor: String? = null) {
        _state.value = if (cursor == null) RecurringDetailState.Loading else _state.value
        scope.launch {
            runCatching { repository.readDetail(id, cursor) }
                .onSuccess { detail -> _state.value = RecurringDetailState.Ready(detail) }
                .onFailure { error -> _state.value = RecurringDetailState.Error(error.message ?: "Recurring details are unavailable.") }
        }
    }

    fun saveClassification(id: String, expectedRevision: Int, classification: String) {
        val current = _state.value as? RecurringDetailState.Ready ?: return
        if (current.saving) return
        if (current.detail.stream.id != id || current.detail.stream.revision != expectedRevision) {
            _state.value = current.copy(
                saving = false,
                saveError = "The recurring stream changed; refresh before saving.",
            )
            return
        }
        _state.value = current.copy(saving = true, saveError = null)
        scope.launch {
            runCatching { repository.classify(id, expectedRevision, classification) }
                .onSuccess { load(id) }
                .onFailure { error ->
                    val ready = _state.value as? RecurringDetailState.Ready
                    if (ready != null) {
                        _state.value = ready.copy(saving = false, saveError = error.message ?: "Classification could not be saved.")
                    }
                }
        }
    }
}

sealed interface RecurringDetailState {
    data object Loading : RecurringDetailState
    data class Ready(
        val detail: RecurringDetailDto,
        val saving: Boolean = false,
        val saveError: String? = null,
    ) : RecurringDetailState
    data class Error(val message: String) : RecurringDetailState
}
