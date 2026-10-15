package com.lofuyu.borderledger.ui.settings

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicLong

data class SettingsState(
    val loading: Boolean = false,
    val preferences: ReportingPreferences? = null,
    val saving: Boolean = false,
    val conflictRevision: Int? = null,
    val error: String? = null,
)

class SettingsViewModel(
    private val repository: ReportingPreferencesRepository,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
) {
    private val _state = MutableStateFlow(SettingsState())
    val state: StateFlow<SettingsState> = _state.asStateFlow()
    private val nextOperation = AtomicLong(0)
    private val activeOperation = AtomicLong(0)

    fun load() {
        val operation = nextOperation.incrementAndGet()
        activeOperation.set(operation)
        _state.value = _state.value.copy(loading = true, error = null)
        scope.launch {
            runCatching { repository.read() }
                .onSuccess { value ->
                    if (activeOperation.get() == operation) _state.value = SettingsState(preferences = value)
                }
                .onFailure { error ->
                    if (activeOperation.get() == operation) _state.value = _state.value.copy(loading = false, error = error.message ?: "Preferences are unavailable.")
                }
        }
    }

    fun save(update: ReportingPreferencesUpdate) {
        val current = _state.value.preferences ?: return
        val operation = nextOperation.incrementAndGet()
        activeOperation.set(operation)
        _state.value = _state.value.copy(saving = true, conflictRevision = null, error = null)
        scope.launch {
            runCatching { repository.update(current.revision, update) }
                .onSuccess { value ->
                    if (activeOperation.get() == operation) _state.value = SettingsState(preferences = value)
                }
                .onFailure { error ->
                    if (activeOperation.get() != operation) return@onFailure
                    if (error is ReportingPreferencesRepository.RevisionConflict) {
                        _state.value = _state.value.copy(saving = false, conflictRevision = error.currentRevision, error = error.message)
                    } else {
                        _state.value = _state.value.copy(saving = false, error = error.message ?: "Preferences could not be saved.")
                    }
                }
        }
    }
}
